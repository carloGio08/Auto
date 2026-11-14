import { clamp, lerp, smoothstep } from '../math/util';
import type { SurfaceId, TrailDef } from '../data/types';
import type { Mountain } from './mountain';
import type { DenseLine } from './trailRouter';

export const ROAD_BRIDGE = 1;
export const ROAD_HAIRPIN = 2;

/** Result of a nearest-trail query. Pre-allocate and reuse. */
export interface RoadQuery {
  found: boolean;
  /** Global sample index of the segment start, parameter, trail index. */
  index: number;
  t: number;
  trail: number;
  /** Distance along that trail (m). */
  s: number;
  /** Signed lateral offset (+ = left of the travel direction) and absolute distance. */
  lateral: number;
  distance: number;
  /** Trail centre height, half width, cross slope (banking) and carve strength. */
  y: number;
  halfWidth: number;
  bank: number;
  carve: number;
  found2: boolean;
  s2: number;
  distance2: number;
  lateral2: number;
  y2: number;
  halfWidth2: number;
  bank2: number;
  /** 0..1 blending weight of the second candidate. */
  weight2: number;
}

export function createRoadQuery(): RoadQuery {
  return {
    found: false,
    index: 0,
    t: 0,
    trail: 0,
    s: 0,
    lateral: 0,
    distance: Infinity,
    y: 0,
    halfWidth: 0,
    bank: 0,
    carve: 1,
    found2: false,
    s2: 0,
    distance2: Infinity,
    lateral2: 0,
    y2: 0,
    halfWidth2: 0,
    bank2: 0,
    weight2: 0,
  };
}

export interface RoadPoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
  s: number;
  index: number;
}

export const createRoadPoint = (): RoadPoint => ({
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  halfWidth: 5,
  s: 0,
  index: 0,
});

export interface TrailInfo {
  def: TrailDef;
  /** First global sample index and number of samples. */
  start: number;
  count: number;
  length: number;
}

const SPACING = 2;

/**
 * The trail network: every trail of a mountain resampled every 2 m into shared arrays, with
 * height profile, banking, width, bridges and a spatial grid for O(1) nearest-point queries.
 * Trails are not meshes: Terrain carves them into height(x, z).
 */
export class Road {
  readonly spacing = SPACING;
  readonly count: number;
  readonly trails: TrailInfo[];
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly y: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly curvature: Float32Array;
  readonly halfWidth: Float32Array;
  readonly bank: Float32Array;
  readonly carve: Float32Array;
  readonly flags: Uint8Array;
  readonly trailOf: Int16Array;
  readonly bridges: { trail: number; from: number; to: number }[] = [];
  readonly maxHalfWidth: number;
  readonly influence: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  private readonly cellSize = 24;
  private readonly gridMinX: number;
  private readonly gridMinZ: number;
  private readonly gridW: number;
  private readonly gridH: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly minScratch = new Float64Array(96);

  constructor(defs: TrailDef[], lines: DenseLine[], mountain: Mountain) {
    const stride = SPACING;
    this.trails = [];
    let total = 0;
    lines.forEach((line, k) => {
      const count = Math.floor((line.x.length - 1) / stride) + 1;
      this.trails.push({ def: defs[k], start: total, count, length: (count - 1) * stride });
      total += count;
    });
    const n = (this.count = total);
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.y = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.halfWidth = new Float32Array(n);
    this.bank = new Float32Array(n);
    this.carve = new Float32Array(n).fill(1);
    this.flags = new Uint8Array(n);
    this.trailOf = new Int16Array(n);
    let maxHalf = 0;
    this.trails.forEach((tr, k) => {
      const line = lines[k];
      for (let i = 0; i < tr.count; i++) {
        const g = tr.start + i;
        const j = i * stride;
        this.x[g] = line.x[j];
        this.z[g] = line.z[j];
        this.tx[g] = Math.sin(line.h[j]);
        this.tz[g] = Math.cos(line.h[j]);
        this.trailOf[g] = k;
      }
      this.buildGeometry(tr);
      for (let i = 0; i < tr.count; i++) maxHalf = Math.max(maxHalf, this.halfWidth[tr.start + i]);
    });
    this.maxHalfWidth = maxHalf;
    // Profiles: main first, then branches anchored to the trails they join.
    this.trails.forEach((tr) => this.buildProfile(tr, mountain));

    // Spatial grid (must cover the widest adaptive shoulder: terrain.ts MAX_SHOULDER = 30 m).
    this.influence = maxHalf + 30 + 10;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.x[i]);
      maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]);
      maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    const pad = this.influence + this.cellSize;
    this.gridMinX = minX - pad;
    this.gridMinZ = minZ - pad;
    this.gridW = Math.ceil((maxX - minX + 2 * pad) / this.cellSize);
    this.gridH = Math.ceil((maxZ - minZ + 2 * pad) / this.cellSize);
    const counts = new Int32Array(this.gridW * this.gridH);
    const visit = (i: number, fn: (c: number) => void): void => {
      const inf = this.influence;
      const cx0 = Math.max(
        0,
        Math.floor((Math.min(this.x[i], this.x[i + 1]) - inf - this.gridMinX) / this.cellSize),
      );
      const cx1 = Math.min(
        this.gridW - 1,
        Math.floor((Math.max(this.x[i], this.x[i + 1]) + inf - this.gridMinX) / this.cellSize),
      );
      const cz0 = Math.max(
        0,
        Math.floor((Math.min(this.z[i], this.z[i + 1]) - inf - this.gridMinZ) / this.cellSize),
      );
      const cz1 = Math.min(
        this.gridH - 1,
        Math.floor((Math.max(this.z[i], this.z[i + 1]) + inf - this.gridMinZ) / this.cellSize),
      );
      for (let cz = cz0; cz <= cz1; cz++)
        for (let cx = cx0; cx <= cx1; cx++) fn(cz * this.gridW + cx);
    };
    for (let i = 0; i < n - 1; i++) if (this.segmentValid(i)) visit(i, (c) => counts[c]++);
    this.cellStart = new Int32Array(counts.length + 1);
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      this.cellStart[c] = acc;
      acc += counts[c];
    }
    this.cellStart[counts.length] = acc;
    this.cellItems = new Int32Array(acc);
    const fill = new Int32Array(counts.length);
    for (let i = 0; i < n - 1; i++) {
      if (this.segmentValid(i))
        visit(i, (c) => (this.cellItems[this.cellStart[c] + fill[c]++] = i));
    }
  }

  get main(): TrailInfo {
    return this.trails[0];
  }

  /** Length of the main trail. */
  get length(): number {
    return this.trails[0].length;
  }

  segmentValid(i: number): boolean {
    return i + 1 < this.count && this.trailOf[i] === this.trailOf[i + 1];
  }

  /** Curvature, variable width and hairpin widening for one trail. */
  private buildGeometry(tr: TrailInfo): void {
    const { start, count } = tr;
    const ds = SPACING;
    for (let i = 0; i < count; i++) {
      const a = start + Math.max(0, i - 1);
      const b = start + Math.min(count - 1, i + 1);
      let dh = Math.atan2(this.tx[b], this.tz[b]) - Math.atan2(this.tx[a], this.tz[a]);
      if (dh > Math.PI) dh -= 2 * Math.PI;
      if (dh < -Math.PI) dh += 2 * Math.PI;
      this.curvature[start + i] = dh / ((b - a) * ds || 1);
    }
    const [w0, w1] = tr.def.width;
    const phase = tr.start * 0.37;
    for (let i = 0; i < count; i++) {
      const g = start + i;
      let k = 0;
      let ks = 0;
      for (let o = -6; o <= 6; o++) {
        const c = this.curvature[start + clamp(i + o, 0, count - 1)];
        k = Math.max(k, Math.abs(c));
        ks += c;
      }
      const tight = smoothstep(1 / 60, 1 / 16, k);
      if (tight > 0.5) this.flags[g] |= ROAD_HAIRPIN;
      const s = i * ds;
      this.halfWidth[g] = lerp(w0, w1, 0.5 + 0.5 * Math.sin(s / 110 + phase)) * 0.5 + tight * 2;
      // Banking: the outside of a bend is higher (left turn → left side lower).
      this.bank[g] = clamp((-ks / 13) * 4.5, -0.08, 0.08);
    }
  }

  private buildProfile(tr: TrailInfo, mountain: Mountain): void {
    const { start, count } = tr;
    const ds = SPACING;
    const raw = new Float32Array(count);
    for (let i = 0; i < count; i++)
      raw[i] = mountain.heightNoWater(this.x[start + i], this.z[start + i]);
    const smooth = (src: Float32Array, half: number): Float32Array => {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        let sum = 0;
        let c = 0;
        for (let o = -half; o <= half; o++) {
          sum += src[clamp(i + o, 0, count - 1)];
          c++;
        }
        out[i] = sum / c;
      }
      return out;
    };
    let prof = smooth(smooth(raw, 10), 10);
    const g = tr.def.maxGrade * 1.15;
    for (let i = 1; i < count; i++)
      prof[i] = clamp(prof[i], prof[i - 1] - g * ds, prof[i - 1] + g * 0.6 * ds);
    prof = smooth(prof, 3);
    // Anchor branch ends onto the trails they join so junctions are seamless.
    const anchor = (x: number, z: number): number | null => {
      let best = Infinity;
      let y: number | null = null;
      for (const other of this.trails) {
        if (other === tr || other.start >= tr.start) continue;
        for (let i = 0; i < other.count; i++) {
          const gi = other.start + i;
          const d = Math.hypot(this.x[gi] - x, this.z[gi] - z);
          if (d < best && d < 12) {
            best = d;
            y = this.y[gi];
          }
        }
      }
      return y;
    };
    const L = (count - 1) * ds;
    const a0 = tr.def.startOn ? anchor(this.x[start], this.z[start]) : null;
    const a1 = tr.def.endOn ? anchor(this.x[start + count - 1], this.z[start + count - 1]) : null;
    const d0 = a0 === null ? 0 : a0 - prof[0];
    const d1 = a1 === null ? 0 : a1 - prof[count - 1];
    const ramp = Math.min(120, L * 0.4);
    for (let i = 0; i < count; i++) {
      const s = i * ds;
      prof[i] += d0 * (1 - smoothstep(0, ramp, s)) + d1 * smoothstep(L - ramp, L, s);
    }
    // Where a branch still overlaps the trail it joins (first/last metres), follow its height.
    if (tr.def.startOn || tr.def.endOn) {
      const span = Math.min(count, 50);
      const ends = [
        ...Array(span).keys(),
        ...Array.from({ length: span }, (_, k) => count - 1 - k),
      ];
      for (const i of ends) {
        const gx = this.x[start + i];
        const gz = this.z[start + i];
        let best = Infinity;
        let by = 0;
        let bw = 0;
        for (const other of this.trails) {
          if (other.start >= tr.start) continue;
          for (let k = 0; k < other.count; k += 1) {
            const g = other.start + k;
            const d = Math.abs(this.x[g] - gx) + Math.abs(this.z[g] - gz);
            if (d < best) {
              best = d;
              by = this.y[g];
              bw = this.halfWidth[g];
            }
          }
        }
        const f = 1 - smoothstep(bw, bw + 14, best);
        prof[i] = prof[i] + (by - prof[i]) * f;
      }
    }
    // Bridges where the trail crosses a river: a flat deck between the two banks.
    const crossing = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const r = mountain.riverDistance(this.x[start + i], this.z[start + i]);
      if (r < 9) crossing[i] = 1;
    }
    let i = 0;
    while (i < count) {
      if (!crossing[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < count && crossing[j]) j++;
      const a = Math.max(1, i - 4);
      const b = Math.min(count - 2, j + 3);
      const ya = prof[a - 1];
      const yb = prof[b + 1];
      // The deck must clear the water: lift it (with gentle ramps on both banks) if needed.
      let lift = 0;
      for (let k = a; k <= b; k++) {
        const w = mountain.waterLevel(this.x[start + k], this.z[start + k]);
        lift = Math.max(lift, w + 1.6 - lerp(ya, yb, (k - a) / Math.max(1, b - a)));
      }
      if (lift > 0) {
        const ramp = 15;
        for (let k = Math.max(0, a - ramp); k <= Math.min(count - 1, b + ramp); k++) {
          const f = k < a ? smoothstep(a - ramp, a, k) : k > b ? 1 - smoothstep(b, b + ramp, k) : 1;
          prof[k] += lift * f;
        }
      }
      for (let k = a; k <= b; k++) {
        prof[k] = lerp(ya, yb, (k - a) / Math.max(1, b - a)) + lift;
        this.flags[start + k] |= ROAD_BRIDGE;
        this.carve[start + k] = 0;
        this.halfWidth[start + k] = Math.min(this.halfWidth[start + k], 2.9);
        this.bank[start + k] = 0;
      }
      this.bridges.push({ trail: this.trails.indexOf(tr), from: a * ds, to: b * ds });
      i = j;
    }
    for (let k = 0; k < count; k++) this.y[start + k] = prof[k];
  }

  isBridgeAt(s: number, margin = 0, trail = 0): boolean {
    for (const b of this.bridges)
      if (b.trail === trail && s >= b.from - margin && s <= b.to + margin) return true;
    return false;
  }

  surfaceAt(index: number): SurfaceId {
    return this.flags[index] & ROAD_BRIDGE ? 'wood' : 'trail';
  }

  /** Interpolated point at distance s along a trail (default: main). */
  pointAt(s: number, out: RoadPoint, trail = 0): RoadPoint {
    const tr = this.trails[trail];
    const f = clamp(s / SPACING, 0, tr.count - 1.0001);
    const li = Math.floor(f);
    const t = f - li;
    const i = tr.start + li;
    out.index = i;
    out.s = clamp(s, 0, tr.length);
    out.x = lerp(this.x[i], this.x[i + 1], t);
    out.z = lerp(this.z[i], this.z[i + 1], t);
    out.y = lerp(this.y[i], this.y[i + 1], t);
    let tx = lerp(this.tx[i], this.tx[i + 1], t);
    let tz = lerp(this.tz[i], this.tz[i + 1], t);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    out.tx = tx;
    out.tz = tz;
    out.halfWidth = lerp(this.halfWidth[i], this.halfWidth[i + 1], t);
    return out;
  }

  /**
   * Closest trail point and, between two parts of the network (switchback legs, junctions),
   * the closest point of the other part. Projection uses normals interpolated between vertex
   * normals (a quadratic per segment) so ownership of space is continuous inside bends.
   */
  query(px: number, pz: number, out: RoadQuery): RoadQuery {
    out.found = false;
    out.found2 = false;
    out.weight2 = 0;
    out.distance = Infinity;
    out.distance2 = Infinity;
    const cx = Math.floor((px - this.gridMinX) / this.cellSize);
    const cz = Math.floor((pz - this.gridMinZ) / this.cellSize);
    if (cx < 0 || cz < 0 || cx >= this.gridW || cz >= this.gridH) return out;
    const c = cz * this.gridW + cx;
    const start = this.cellStart[c];
    const end = this.cellStart[c + 1];
    if (start === end) return out;
    const X = this.x;
    const Z = this.z;
    const TX = this.tx;
    const TZ = this.tz;
    const mins = this.minScratch;
    let nMin = 0;
    for (let k = start; k < end && nMin < 32; k++) {
      const i = this.cellItems[k];
      const ax = X[i];
      const az = Z[i];
      const dx = X[i + 1] - ax;
      const dz = Z[i + 1] - az;
      const nax = TZ[i];
      const naz = -TX[i];
      const dnx = TZ[i + 1] - nax;
      const dnz = -TX[i + 1] - naz;
      const ux = px - ax;
      const uz = pz - az;
      // Solve (u - t d) × (na + t dn) = 0 for t.
      const A = -(dx * dnz - dz * dnx);
      const B = ux * dnz - uz * dnx - (dx * naz - dz * nax);
      const C = ux * naz - uz * nax;
      let r1 = NaN;
      let r2 = NaN;
      if (Math.abs(A) < 1e-9) {
        if (Math.abs(B) > 1e-12) r1 = -C / B;
      } else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          r1 = (-B - sq) / (2 * A);
          r2 = (-B + sq) / (2 * A);
        }
      }
      const firstOfTrail = i === 0 || this.trailOf[i - 1] !== this.trailOf[i];
      const lastOfTrail = !this.segmentValid(i + 1);
      const eps = 1e-5;
      const lo = firstOfTrail ? -0.5 : -eps;
      const hi = lastOfTrail ? 1.5 : 1 + eps;
      let t = NaN;
      let bestD = Infinity;
      for (const r of [r1, r2]) {
        if (!(r >= lo && r <= hi)) continue;
        const rc = r < 0 ? 0 : r > 1 ? 1 : r;
        const ex = ax + dx * rc - px;
        const ez = az + dz * rc - pz;
        const dd = ex * ex + ez * ez;
        if (dd < bestD) {
          bestD = dd;
          t = rc;
        }
      }
      if (Number.isNaN(t)) continue;
      // Ownership boundaries are shared: the next segment owns the vertex.
      if (t >= 1 && !lastOfTrail) continue;
      const qx = ax + dx * t - px;
      const qz = az + dz * t - pz;
      mins[nMin * 3] = qx * qx + qz * qz;
      mins[nMin * 3 + 1] = i;
      mins[nMin * 3 + 2] = t;
      nMin++;
    }
    if (nMin === 0) return out;
    let b = 0;
    for (let m = 1; m < nMin; m++) if (mins[m * 3] < mins[b * 3]) b = m;
    const bi = mins[b * 3 + 1];
    this.fill(out, bi, mins[b * 3 + 2], px, pz, false);
    // Second candidate: another trail, or a part of the same trail > 20 m away along it.
    let b2 = -1;
    for (let m = 0; m < nMin; m++) {
      if (m === b) continue;
      const i = mins[m * 3 + 1];
      if (this.trailOf[i] === this.trailOf[bi] && Math.abs(i - bi) * SPACING <= 20) continue;
      if (b2 < 0 || mins[m * 3] < mins[b2 * 3]) b2 = m;
    }
    if (b2 >= 0) {
      const i2 = mins[b2 * 3 + 1];
      this.fill(out, i2, mins[b2 * 3 + 2], px, pz, true);
      out.weight2 =
        this.trailOf[i2] !== this.trailOf[bi] ? 1 : smoothstep(20, 60, Math.abs(out.s2 - out.s));
    }
    return out;
  }

  private fill(
    out: RoadQuery,
    i: number,
    t: number,
    px: number,
    pz: number,
    second: boolean,
  ): void {
    const ax = this.x[i];
    const az = this.z[i];
    const dx = this.x[i + 1] - ax;
    const dz = this.z[i + 1] - az;
    const len = Math.hypot(dx, dz) || 1;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const nx = dz / len;
    const nz = -dx / len;
    const lateral = (px - qx) * nx + (pz - qz) * nz;
    const distance = Math.hypot(px - qx, pz - qz);
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    const hw = this.halfWidth[i] + (this.halfWidth[i + 1] - this.halfWidth[i]) * t;
    const bank = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    const tr = this.trails[this.trailOf[i]];
    const s = (i - tr.start + t) * SPACING;
    if (!second) {
      out.found = true;
      out.index = i;
      out.t = t;
      out.trail = this.trailOf[i];
      out.s = s;
      out.lateral = lateral;
      out.distance = distance;
      out.y = y;
      out.halfWidth = hw;
      out.bank = bank;
      out.carve = this.carve[i] + (this.carve[i + 1] - this.carve[i]) * t;
    } else {
      out.found2 = true;
      out.s2 = s;
      out.lateral2 = lateral;
      out.distance2 = distance;
      out.y2 = y;
      out.halfWidth2 = hw;
      out.bank2 = bank;
    }
  }
}
