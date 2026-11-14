import { Simplex2 } from '../math/noise';
import { clamp, smoothstep } from '../math/util';
import type { MountainDef } from '../data/types';
import { createPolylineHit, PolylineIndex } from './polyline';

/** A river: polyline with a monotone bed altitude, carved into the natural terrain. */
export interface River {
  x: Float32Array;
  z: Float32Array;
  /** Bank altitude along the river (non-increasing towards the lake). */
  bank: Float32Array;
  width: number;
  depth: number;
}

const BANK_SLOPE = 0.9;
const ROUND = 0.2;

/**
 * Linear ramp 0→1 with quadratic rounded ends: the steepest slope of the massif is only
 * 1/(1-ROUND) times the average, which keeps the whole face drivable.
 */
function roundedRamp(t: number): number {
  const a = ROUND;
  const k = 2 * a * (1 - a);
  if (t < a) return (t * t) / k;
  if (t > 1 - a) return 1 - ((1 - t) * (1 - t)) / k;
  return (t - a / 2) / (1 - a);
}

/**
 * The natural (un-carved) mountain, a pure deterministic function of (x, z) and the seed:
 * warped massif profile with plateau summit, soft spurs radiating from the top, low and mid
 * frequency noise, natural rim walls at the map border, a few explicit cliffs, the lake
 * basin and river channels. No high-frequency noise: the surface stays smooth and drivable.
 */
export class Mountain {
  readonly def: MountainDef;
  private readonly noise: Simplex2;
  private readonly warpNoise: Simplex2;
  private readonly spurPhase: number;
  private readonly tPlateau: number;
  rivers: River[] = [];
  private riverIndex: PolylineIndex | null = null;
  private riverOf = new Int16Array(0);
  private riverOffset: number[] = [];
  private readonly hit = createPolylineHit();
  private readonly cliffs: {
    cx: number;
    cz: number;
    ux: number;
    uz: number;
    half: number;
    height: number;
    width: number;
  }[];

  constructor(def: MountainDef) {
    this.def = def;
    this.noise = new Simplex2(def.seed);
    this.warpNoise = new Simplex2(def.seed ^ 0x5bd1e995);
    this.spurPhase = ((def.seed % 997) / 997) * Math.PI * 2;
    const minR = Math.min(def.radii.north, def.radii.south, def.radii.east, def.radii.west);
    this.tPlateau = def.summit.plateauRadius / minR;
    this.cliffs = def.cliffs.map((c) => ({
      cx: c.x,
      cz: c.z,
      ux: Math.sin(c.angle),
      uz: Math.cos(c.angle),
      half: c.length / 2,
      height: c.height,
      width: c.width,
    }));
  }

  get summitHeight(): number {
    return this.def.summit.height;
  }

  /** Natural height without river channels and lake basin (used to route trails). */
  heightNoWater(x: number, z: number): number {
    const d = this.def;
    const n = d.noise;
    // Domain warping keeps the massif from looking like a perfect cone.
    const ws = 1 / n.warpScale;
    const wx = x + n.warp * this.warpNoise.fbm(x * ws, z * ws, 2);
    const wz = z + n.warp * this.warpNoise.fbm(x * ws + 31.4, z * ws - 17.3, 2);
    const dx = wx - d.summit.x;
    const dz = wz - d.summit.z;
    const rx = dx >= 0 ? d.radii.east : d.radii.west;
    const rz = dz >= 0 ? d.radii.south : d.radii.north;
    const t = Math.sqrt((dx / rx) * (dx / rx) + (dz / rz) * (dz / rz));
    const t2 = clamp((t - this.tPlateau) / (1 - this.tPlateau), 0, 1);
    let h = d.baseHeight + (d.summit.height - d.baseHeight) * (1 - roundedRamp(t2));
    // Soft spurs (smooth crests, no spikes), fading at the summit and the foot.
    if (t > 0.02 && t < 1) {
      const theta = Math.atan2(dx, dz);
      const s = Math.cos(d.spurs.count * theta + d.spurs.twist * t * 6 + this.spurPhase);
      const ridge = ((s + 1) * 0.5) ** 2;
      const env = Math.sin(Math.PI * t) * smoothstep(0.02, 0.15, t);
      h += d.spurs.amplitude * (ridge - 0.33) * env;
    }
    // Low / mid frequency undulations, calmer on the summit plateau.
    const calm = 0.35 + 0.65 * smoothstep(this.tPlateau, this.tPlateau + 0.12, t);
    h += n.low.amplitude * this.noise.fbm(x / n.low.scale, z / n.low.scale, 3) * calm;
    h += n.mid.amplitude * this.noise.fbm(x / n.mid.scale + 11.7, z / n.mid.scale - 4.2, 2) * calm;
    // Natural boundary: ridges rising towards the map border.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > d.halfSize * 0.8) {
      const rim = smoothstep(d.halfSize * 0.82, d.halfSize * 1.15, edge);
      h += d.rimHeight * rim * (0.75 + 0.25 * this.noise.fbm(x / 900 + 5.5, z / 900, 2));
    }
    // A few recognisable rock walls.
    for (const c of this.cliffs) {
      const rx2 = x - c.cx;
      const rz2 = z - c.cz;
      const u = rx2 * c.ux + rz2 * c.uz;
      if (Math.abs(u) > c.half) continue;
      const v = rx2 * c.uz - rz2 * c.ux;
      if (Math.abs(v) > c.width * 3) continue;
      const win = 1 - smoothstep(c.half * 0.6, c.half, Math.abs(u));
      h += c.height * (smoothstep(-c.width / 2, c.width / 2, v) - 0.5) * win;
    }
    return h;
  }

  /** Lake bed: the valley dips below the lake level inside the lake radius. */
  private lakeBed(x: number, z: number): number {
    const l = this.def.lake;
    const dist = Math.hypot(x - l.x, (z - l.z) * 1.15);
    // Flat bed inside the lake, steep rise just outside: the valley floor takes over again.
    return (
      l.level -
      6 +
      6 * smoothstep(l.radius * 0.6, l.radius, dist) +
      Math.max(0, dist - l.radius) * 0.8
    );
  }

  /** Full natural height: massif, lake basin and river channels. */
  height(x: number, z: number): number {
    let h = this.heightNoWater(x, z);
    h = Math.min(h, this.lakeBed(x, z));
    if (this.riverIndex) {
      const r = this.riverIndex.nearest(x, z, this.hit);
      if (r.found) h = Math.min(h, this.riverBed(r.index, r.t, r.distance));
    }
    return h;
  }

  private riverBed(i: number, t: number, distance: number): number {
    const river = this.rivers[this.riverOf[i]];
    const j = i - this.riverOffset[this.riverOf[i]];
    const bank = river.bank[j] + (river.bank[j + 1] - river.bank[j]) * t;
    // The channel fades in below the spring and rises out of reach at the influence edge.
    const depth = river.depth * Math.min(1, (j + t) / 6);
    return (
      bank -
      depth +
      BANK_SLOPE * Math.max(0, distance - river.width * 0.5) +
      smoothstep(50, 78, distance) * 300
    );
  }

  /** Water surface at (x, z): lake level, or river water when in a channel; -Infinity if dry. */
  waterLevel(x: number, z: number): number {
    let level = this.def.lake.level;
    if (this.riverIndex) {
      const r = this.riverIndex.nearest(x, z, this.hit);
      if (r.found && r.distance < this.rivers[this.riverOf[r.index]].width * 0.5 + 0.5) {
        const river = this.rivers[this.riverOf[r.index]];
        const j = r.index - this.riverOffset[this.riverOf[r.index]];
        const bank = river.bank[j] + (river.bank[j + 1] - river.bank[j]) * r.t;
        level = Math.max(level, bank - river.depth * 0.55);
      }
    }
    return level;
  }

  /** Distance to the closest river (Infinity when far). */
  riverDistance(x: number, z: number): number {
    if (!this.riverIndex) return Infinity;
    const r = this.riverIndex.nearest(x, z, this.hit);
    return r.found ? r.distance : Infinity;
  }

  /**
   * Computes the river paths by steepest descent on a coarse grid from each spring to the
   * lake, then builds a spatial index. Must run before trails are routed.
   */
  buildRivers(): void {
    const d = this.def;
    const step = 20;
    const rivers: River[] = [];
    for (const def of d.rivers) {
      const xs: number[] = [];
      const zs: number[] = [];
      let x = def.spring[0];
      let z = def.spring[1];
      let prevH = Infinity;
      for (let it = 0; it < 500; it++) {
        // Stop in a pond when the descent starts going back and forth.
        const n0 = xs.length;
        if (n0 >= 2 && Math.hypot(xs[n0 - 2] - x, zs[n0 - 2] - z) < step * 0.5) break;
        xs.push(x);
        zs.push(z);
        const h = this.heightNoWater(x, z);
        if (h <= d.lake.level + 1 || Math.hypot(x - d.lake.x, z - d.lake.z) < d.lake.radius * 0.7)
          break;
        // Steepest descent among 16 directions, biased towards the lake to cross flats.
        let best = Infinity;
        let bx = x;
        let bz = z;
        const toLakeX = d.lake.x - x;
        const toLakeZ = d.lake.z - z;
        const tl = Math.hypot(toLakeX, toLakeZ) || 1;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const nx = x + Math.sin(a) * step;
          const nz = z + Math.cos(a) * step;
          const bias = -((Math.sin(a) * toLakeX + Math.cos(a) * toLakeZ) / tl) * 1.2;
          const v = this.heightNoWater(nx, nz) + bias;
          if (v < best) {
            best = v;
            bx = nx;
            bz = nz;
          }
        }
        x = bx;
        z = bz;
        prevH = Math.min(prevH, h);
      }
      if (xs.length < 4) continue;
      // Bank altitude: smoothed natural height, forced non-increasing (water flows down).
      const n = xs.length;
      const bank = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let cnt = 0;
        for (let o = -3; o <= 3; o++) {
          const j = clamp(i + o, 0, n - 1);
          sum += this.heightNoWater(xs[j], zs[j]);
          cnt++;
        }
        bank[i] = sum / cnt;
        if (i > 0) bank[i] = Math.min(bank[i], bank[i - 1] - 0.05);
      }
      rivers.push({
        x: Float32Array.from(xs),
        z: Float32Array.from(zs),
        bank,
        width: def.width,
        depth: def.depth,
      });
    }
    this.rivers = rivers;
    let total = 0;
    this.riverOffset = rivers.map((r) => {
      const o = total;
      total += r.x.length;
      return o;
    });
    const X = new Float32Array(total);
    const Z = new Float32Array(total);
    const valid = new Uint8Array(total);
    this.riverOf = new Int16Array(total);
    rivers.forEach((r, ri) => {
      const o = this.riverOffset[ri];
      X.set(r.x, o);
      Z.set(r.z, o);
      for (let i = 0; i < r.x.length; i++) {
        this.riverOf[o + i] = ri;
        valid[o + i] = i < r.x.length - 1 ? 1 : 0;
      }
    });
    const maxCut = 80;
    this.riverIndex = total > 1 ? new PolylineIndex(X, Z, valid, maxCut, 40) : null;
  }
}
