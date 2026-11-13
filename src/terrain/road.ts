import { Rng } from '../math/rng';
import { clamp, lerp, smoothstep } from '../math/util';
import type { SurfaceId, TrackDef, TrackLayout } from '../data/types';
import type { Mountain } from './mountain';
import { config } from '../config';

export const SURFACE_IDS: SurfaceId[] = [
  'asphalt',
  'dirt',
  'gravel',
  'grass',
  'mud',
  'ice',
  'snow',
  'rock',
  'sand',
  'wood',
];
export const surfaceIndex = (id: SurfaceId): number => SURFACE_IDS.indexOf(id);

export const ROAD_BRIDGE = 1;
export const ROAD_HAIRPIN = 2;
export const ROAD_JUMP = 4;

/** Result of a nearest-road query. Pre-allocate and reuse. */
export interface RoadQuery {
  found: boolean;
  index: number;
  t: number;
  s: number;
  lateral: number;
  distance: number;
  y: number;
  halfWidth: number;
  carve: number;
  found2: boolean;
  s2: number;
  distance2: number;
  lateral2: number;
  y2: number;
  halfWidth2: number;
  /** 0..1 blending weight of the second candidate. */
  weight2: number;
}

export function createRoadQuery(): RoadQuery {
  return {
    found: false,
    index: 0,
    t: 0,
    s: 0,
    lateral: 0,
    distance: Infinity,
    y: 0,
    halfWidth: 0,
    carve: 1,
    found2: false,
    s2: 0,
    distance2: Infinity,
    lateral2: 0,
    y2: 0,
    halfWidth2: 0,
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

export interface JumpInfo {
  /** s of the lip. */
  lip: number;
  height: number;
}

/**
 * Generates a dense 1 m centre line from a layout descriptor.
 * Returns flat arrays of x, z and heading (radians from +Z towards +X).
 */
export function generateCenterline(
  layout: TrackLayout,
  seed: number,
): { x: number[]; z: number[]; h: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const hs: number[] = [];
  if (layout.kind === 'points') {
    return catmullRomPath(layout.points);
  }
  const rng = new Rng(seed ^ 0xa5a5a5);
  let x = 0;
  let z = 0;
  let h = 0;
  const push = (): void => {
    xs.push(x);
    zs.push(z);
    hs.push(h);
  };
  const stepForward = (): void => {
    x += Math.sin(h);
    z += Math.cos(h);
    push();
  };
  const straight = (len: number, base: number, wiggle: number): void => {
    const n = Math.max(1, Math.round(len));
    const k = rng.int(2, 3);
    const lambda = (2 * n) / k;
    const amp = wiggle > 0 ? (wiggle * 2 * Math.PI) / lambda / 2.2 : 0;
    const phaseSign = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < n; i++) {
      h = base + phaseSign * amp * Math.sin((Math.PI * k * i) / n);
      stepForward();
    }
    h = base;
  };
  const arcTo = (target: number, radius: number): void => {
    const total = target - h;
    const n = Math.max(1, Math.round(Math.abs(total) * radius));
    const dh = total / n;
    for (let i = 0; i < n; i++) {
      h += dh;
      stepForward();
    }
    h = target;
  };

  push();
  const hd = (layout.legHeading * Math.PI) / 180;
  let dir: number = layout.firstDirection;
  straight(layout.runIn, 0, 0);
  arcTo(dir * hd, 42);
  const lMid = (layout.legLength[0] + layout.legLength[1]) * 0.5;
  for (let leg = 0; leg < layout.legs; leg++) {
    const target = dir * rng.range(0.5, 0.6) * lMid * Math.sin(hd);
    let len = (target - x) / (dir * Math.sin(hd));
    len = clamp(len, layout.legLength[0] * 0.6, layout.legLength[1]);
    if (leg === layout.legs - 1) len *= 0.6;
    straight(len, dir * hd, layout.wiggle);
    if (leg < layout.legs - 1) {
      arcTo(-dir * hd, layout.hairpinRadius);
      dir = -dir;
    }
  }
  arcTo(0, 55);
  straight(layout.runOut, 0, 0);
  return { x: xs, z: zs, h: hs };
}

/** Centripetal-ish Catmull–Rom through control points, densified at ~1 m. */
function catmullRomPath(points: [number, number][]): { x: number[]; z: number[]; h: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const hs: number[] = [];
  const n = points.length;
  const p = (i: number): [number, number] => points[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const [x0, z0] = p(i - 1);
    const [x1, z1] = p(i);
    const [x2, z2] = p(i + 1);
    const [x3, z3] = p(i + 2);
    const segLen = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(2, Math.ceil(segLen));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const cx =
        0.5 *
        (2 * x1 +
          (-x0 + x2) * t +
          (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 +
          (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
      const cz =
        0.5 *
        (2 * z1 +
          (-z0 + z2) * t +
          (2 * z0 - 5 * z1 + 4 * z2 - z3) * t2 +
          (-z0 + 3 * z1 - 3 * z2 + z3) * t3);
      xs.push(cx);
      zs.push(cz);
    }
  }
  xs.push(points[n - 1][0]);
  zs.push(points[n - 1][1]);
  // Re-space to 1 m and compute headings.
  const outX: number[] = [xs[0]];
  const outZ: number[] = [zs[0]];
  let acc = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    acc += d;
    while (acc >= 1) {
      acc -= 1;
      const t = d > 0 ? 1 - acc / d : 1;
      outX.push(lerp(xs[i - 1], xs[i], t));
      outZ.push(lerp(zs[i - 1], zs[i], t));
    }
  }
  for (let i = 0; i < outX.length; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(outX.length - 1, i + 1);
    hs.push(Math.atan2(outX[b] - outX[a], outZ[b] - outZ[a]));
  }
  return { x: outX, z: outZ, h: hs };
}

/**
 * The road: resampled centre line with height profile, surfaces, bridges, jumps and a spatial
 * grid for O(1) nearest-segment queries.
 */
export class Road {
  readonly count: number;
  readonly spacing: number;
  readonly length: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly y: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly curvature: Float32Array;
  readonly halfWidth: Float32Array;
  readonly carve: Float32Array;
  readonly surface: Uint8Array;
  readonly flags: Uint8Array;
  readonly jumps: JumpInfo[] = [];
  readonly bridges: { from: number; to: number }[] = [];
  readonly maxHalfWidth: number;

  // Spatial grid.
  private readonly cellSize = 24;
  private readonly gridMinX: number;
  private readonly gridMinZ: number;
  private readonly gridW: number;
  private readonly gridH: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  readonly influence: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly minScratch = new Float64Array(96);

  constructor(
    track: TrackDef,
    mountain: Mountain,
    dense = generateCenterline(track.layout, track.seed),
  ) {
    const spacing = config.world.roadSampleSpacing;
    const stride = Math.max(1, Math.round(spacing));
    const n = Math.floor((dense.x.length - 1) / stride) + 1;
    this.count = n;
    this.spacing = stride;
    this.length = (n - 1) * stride;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.y = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.halfWidth = new Float32Array(n);
    this.carve = new Float32Array(n).fill(1);
    this.surface = new Uint8Array(n);
    this.flags = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const j = i * stride;
      this.x[i] = dense.x[j];
      this.z[i] = dense.z[j];
      const h = dense.h[j];
      this.tx[i] = Math.sin(h);
      this.tz[i] = Math.cos(h);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const ha = Math.atan2(this.tx[a], this.tz[a]);
      const hb = Math.atan2(this.tx[b], this.tz[b]);
      let dh = hb - ha;
      if (dh > Math.PI) dh -= 2 * Math.PI;
      if (dh < -Math.PI) dh += 2 * Math.PI;
      this.curvature[i] = dh / ((b - a) * stride || 1);
    }

    // Width, widened in tight corners.
    const baseHalf = track.roadWidth * 0.5;
    let maxHalf = 0;
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let o = -6; o <= 6; o++)
        k = Math.max(k, Math.abs(this.curvature[clamp(i + o, 0, n - 1)]));
      const tight = smoothstep(1 / 60, 1 / 18, k);
      this.halfWidth[i] = baseHalf + tight * 1.8;
      if (tight > 0.5) this.flags[i] |= ROAD_HAIRPIN;
      maxHalf = Math.max(maxHalf, this.halfWidth[i]);
    }
    this.maxHalfWidth = maxHalf;

    this.buildProfile(track, mountain);
    this.buildSurfaces(track);

    // Spatial grid.
    // Must cover the widest adaptive shoulder (terrain.ts MAX_SHOULDER = 30 m) plus a margin.
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
    const cells: number[][] = Array.from({ length: this.gridW * this.gridH }, () => []);
    for (let i = 0; i < n - 1; i++) {
      const sx0 = Math.min(this.x[i], this.x[i + 1]) - this.influence;
      const sx1 = Math.max(this.x[i], this.x[i + 1]) + this.influence;
      const sz0 = Math.min(this.z[i], this.z[i + 1]) - this.influence;
      const sz1 = Math.max(this.z[i], this.z[i + 1]) + this.influence;
      const cx0 = Math.max(0, Math.floor((sx0 - this.gridMinX) / this.cellSize));
      const cx1 = Math.min(this.gridW - 1, Math.floor((sx1 - this.gridMinX) / this.cellSize));
      const cz0 = Math.max(0, Math.floor((sz0 - this.gridMinZ) / this.cellSize));
      const cz1 = Math.min(this.gridH - 1, Math.floor((sz1 - this.gridMinZ) / this.cellSize));
      for (let cz = cz0; cz <= cz1; cz++)
        for (let cx = cx0; cx <= cx1; cx++) cells[cz * this.gridW + cx].push(i);
    }
    this.cellStart = new Int32Array(cells.length + 1);
    let total = 0;
    for (let c = 0; c < cells.length; c++) {
      this.cellStart[c] = total;
      total += cells[c].length;
    }
    this.cellStart[cells.length] = total;
    this.cellItems = new Int32Array(total);
    let k = 0;
    for (const cell of cells) for (const item of cell) this.cellItems[k++] = item;
  }

  private buildProfile(track: TrackDef, mountain: Mountain): void {
    const n = this.count;
    const ds = this.spacing;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = mountain.heightNoChannel(this.x[i], this.z[i]);
    // Low-pass filter (moving average, ~40 m window), twice for a smoother profile.
    const smooth = (src: Float32Array, half: number): Float32Array => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let cnt = 0;
        for (let o = -half; o <= half; o++) {
          const j = clamp(i + o, 0, n - 1);
          sum += src[j];
          cnt++;
        }
        out[i] = sum / cnt;
      }
      return out;
    };
    const half = Math.round(20 / ds);
    let prof = smooth(smooth(raw, half), half);
    // Clamp the grade so the road stays drivable.
    const maxGrade = 0.27;
    for (let i = 1; i < n; i++)
      prof[i] = clamp(prof[i], prof[i - 1] - maxGrade * ds, prof[i - 1] + maxGrade * 0.6 * ds);
    // Keep the road from floating too far above the natural ground (fill), pull back down.
    prof = smooth(prof, Math.round(6 / ds));

    // Bridges where the road crosses the river.
    if (mountain.river) {
      const r = mountain.river;
      const isCrossing = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (
          mountain.riverStrength(this.z[i]) > 0.25 &&
          mountain.riverDistance(this.x[i], this.z[i]) < r.width * 0.5 + 8
        ) {
          isCrossing[i] = 1;
        }
      }
      let i = 0;
      while (i < n) {
        if (!isCrossing[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < n && isCrossing[j]) j++;
        const a = Math.max(1, i - 5);
        const b = Math.min(n - 2, j + 4);
        // Flat straight deck between both abutments, raised above the water if needed.
        const ya = prof[a - 1];
        const yb = prof[b + 1];
        for (let k = a; k <= b; k++) {
          const t = (k - a) / Math.max(1, b - a);
          prof[k] = lerp(ya, yb, t);
          this.flags[k] |= ROAD_BRIDGE;
          this.carve[k] = 0;
          // Bridges are narrower than the road: a risk to manage at speed.
          this.halfWidth[k] = Math.min(this.halfWidth[k], 3.9);
        }
        this.bridges.push({ from: a * ds, to: b * ds });
        i = j;
      }
    }

    // Authored features: jumps (kicker + steeper landing) and bump sections.
    const L = this.length;
    const offset = new Float32Array(n);
    const maxCurvature = (a: number, b: number): number => {
      let k = 0;
      for (let i = Math.max(0, Math.floor(a / ds)); i <= Math.min(n - 1, Math.ceil(b / ds)); i++)
        k = Math.max(k, Math.abs(this.curvature[i]));
      return k;
    };
    for (const jump of track.jumps) {
      // Move the jump to the closest straight stretch so the run-up and landing are not in a bend.
      let lip = -1;
      for (let d = 0; d <= 260 && lip < 0; d += 6) {
        for (const cand of [jump.at * L + d, jump.at * L - d]) {
          if (cand < 80 || cand > L - 90) continue;
          if (
            maxCurvature(cand - jump.length - 25, cand + jump.length * 2.2 + 30) < 1 / 95 &&
            !this.isBridgeAt(cand, 60)
          ) {
            if (this.jumps.every((j) => Math.abs(j.lip - cand) > 90)) {
              lip = cand;
              break;
            }
          }
        }
      }
      if (lip < 0) continue;
      const len = jump.length;
      const h = jump.height;
      const land = len * 2.2;
      for (let i = 0; i < n; i++) {
        const s = i * ds;
        let o = 0;
        if (s >= lip - len && s <= lip) {
          o = h * Math.pow((s - (lip - len)) / len, 1.7);
        } else if (s > lip && s <= lip + 2) {
          o = lerp(h, -0.45 * h, (s - lip) / 2);
        } else if (s > lip + 2 && s <= lip + 2 + land) {
          o = -0.45 * h * (1 - smoothstep(0, 1, (s - lip - 2) / land));
        }
        if (o !== 0) {
          offset[i] += o;
          this.flags[i] |= ROAD_JUMP;
        }
      }
      this.jumps.push({ lip, height: h });
      // Wider landing zone: forgiving when the road bends slightly under the car.
      for (
        let i = Math.max(0, Math.floor((lip - len) / ds));
        i <= Math.min(n - 1, Math.ceil((lip + land + 25) / ds));
        i++
      ) {
        const s = i * ds;
        const w = smoothstep(lip - len, lip, s) * (1 - smoothstep(lip + land, lip + land + 25, s));
        this.halfWidth[i] += 2.2 * w;
      }
    }
    for (const b of track.bumps) {
      const s0 = b.from * L;
      const s1 = b.to * L;
      for (let i = 0; i < n; i++) {
        const s = i * ds;
        if (s < s0 || s > s1) continue;
        const env = smoothstep(s0, s0 + 10, s) * (1 - smoothstep(s1 - 10, s1, s));
        offset[i] += b.amplitude * env * (0.5 + 0.5 * Math.sin((s - s0) * ((2 * Math.PI) / 14)));
      }
    }
    for (let i = 0; i < n; i++) {
      this.y[i] = prof[i] + (this.flags[i] & ROAD_BRIDGE ? 0 : offset[i]);
    }
  }

  private buildSurfaces(track: TrackDef): void {
    const base = surfaceIndex(track.roadSurface);
    const L = this.length;
    for (let i = 0; i < this.count; i++) {
      const s = i * this.spacing;
      let surf = base;
      for (const zone of track.surfaces)
        if (s >= zone.from * L && s <= zone.to * L) surf = surfaceIndex(zone.surface);
      if (this.flags[i] & ROAD_BRIDGE) surf = surfaceIndex('wood');
      this.surface[i] = surf;
    }
  }

  isBridgeAt(s: number, margin = 0): boolean {
    for (const b of this.bridges) if (s >= b.from - margin && s <= b.to + margin) return true;
    return false;
  }

  surfaceAt(s: number): SurfaceId {
    const i = clamp(Math.round(s / this.spacing), 0, this.count - 1);
    return SURFACE_IDS[this.surface[i]];
  }

  /** Interpolated point at distance s along the road. */
  pointAt(s: number, out: RoadPoint): RoadPoint {
    const f = clamp(s / this.spacing, 0, this.count - 1.0001);
    const i = Math.floor(f);
    const t = f - i;
    out.index = i;
    out.s = clamp(s, 0, this.length);
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
   * Finds the closest point of the road and, when the point sits between two parts of the
   * road (e.g. inside a switchback), the closest point of the other part.
   *
   * "Parts" are local minima of the distance along the polyline: a projection that falls
   * inside a segment, or a vertex both neighbours clamp to. Local minima only appear or merge
   * where their distances are equal, which keeps the blended terrain height continuous.
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
    const last = this.count - 2;
    // Pass 1: collect the segments that "own" the point. Ownership uses normals interpolated
    // between the vertex normals, so neighbouring segments partition space continuously
    // (no jumps of the closest point on the inside of bends).
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
      // Vertex normals (left of the tangent).
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
      // Candidate roots (up to two); keep the valid one closest to the point.
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
      const eps = 1e-5;
      const lo = i === 0 ? -Infinity : -eps;
      const hi = i === last ? Infinity : 1 + eps;
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
      // Ownership boundaries are shared: skip t == 1 (the next segment owns the vertex).
      if (t >= 1 && i < last) continue;
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
    // Pass 2: closest minimum on a clearly different part of the road (> 20 m away along it).
    let b2 = -1;
    for (let m = 0; m < nMin; m++) {
      if (m === b || Math.abs(mins[m * 3 + 1] - bi) * this.spacing <= 20) continue;
      if (b2 < 0 || mins[m * 3] < mins[b2 * 3]) b2 = m;
    }
    if (b2 >= 0) {
      this.fill(out, mins[b2 * 3 + 1], mins[b2 * 3 + 2], px, pz, true);
      // Fade in with the separation so minima can appear/merge without a height step.
      out.weight2 = smoothstep(20, 60, Math.abs(out.s2 - out.s));
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
    // Left normal (+X when travelling towards +Z).
    const nx = dz / len;
    const nz = -dx / len;
    const lateral = (px - qx) * nx + (pz - qz) * nz;
    const distance = Math.hypot(px - qx, pz - qz);
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    const hw = this.halfWidth[i] + (this.halfWidth[i + 1] - this.halfWidth[i]) * t;
    const s = (i + t) * this.spacing;
    if (!second) {
      out.found = true;
      out.index = i;
      out.t = t;
      out.s = s;
      out.lateral = lateral;
      out.distance = distance;
      out.y = y;
      out.halfWidth = hw;
      out.carve = this.carve[i] + (this.carve[i + 1] - this.carve[i]) * t;
    } else {
      out.found2 = true;
      out.s2 = s;
      out.lateral2 = lateral;
      out.distance2 = distance;
      out.y2 = y;
      out.halfWidth2 = hw;
    }
  }
}
