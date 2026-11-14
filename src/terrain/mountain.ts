import { Simplex2 } from '../math/noise';
import { clamp, smoothstep } from '../math/util';
import { generateTerrain, type TerrainData } from './generator';
import { Heightfield } from './heightfield';
import type { MountainDef } from '../data/types';
import { biomes } from '../data/biomes';
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

/**
 * The natural (un-carved) mountain: the generated heightmap (landforms + erosion, see
 * generator.ts) sampled with a smooth cubic B-spline, plus low-amplitude analytic detail
 * that is stronger on rugged crests and faces and almost nil on meadows and terraces. The
 * lake basin and the stream channels are carved on top. Pure and deterministic.
 */
export class Mountain {
  readonly def: MountainDef;
  readonly field: Heightfield;
  /** Generated data (shared with workers). */
  readonly data: TerrainData;
  private readonly detail: Simplex2;
  private readonly meso: Simplex2;
  private readonly detailAmp: number;
  private readonly detailRugged: number;
  private readonly detailInv: number;
  rivers: River[] = [];
  private riverIndex: PolylineIndex | null = null;
  private riverOf = new Int16Array(0);
  private riverOffset: number[] = [];
  private readonly hit = createPolylineHit();

  constructor(def: MountainDef, data?: TerrainData) {
    this.def = def;
    this.data = data ?? generateTerrain(def);
    this.field = new Heightfield(this.data.field);
    this.detail = new Simplex2(def.seed ^ 0x6d2b79f5);
    this.meso = new Simplex2(def.seed ^ 0x2545f491);
    this.detailAmp = def.noise.detail.amplitude;
    this.detailRugged = def.noise.detail.rugged;
    this.detailInv = 1 / def.noise.detail.scale;
  }

  get summitHeight(): number {
    return this.def.summit.height;
  }

  /** Large-scale natural height: heightmap and detail noise, no meso relief. */
  heightMacro(x: number, z: number): number {
    const amp = this.detailAmp + this.detailRugged * this.field.rough(x, z);
    const k = this.detailInv;
    return this.field.sample(x, z) + amp * this.detail.fbm(x * k, z * k, 2);
  }

  /** Natural height without stream channels and lake basin (used to route trails). */
  heightNoWater(x: number, z: number): number {
    const h = this.heightMacro(x, z);
    const m = this.field.meso(x, z);
    return m > 0.004 ? h + m * this.mesoRelief(x, z, h) : h;
  }

  /**
   * Meso relief of slopes (m, before the slope mask; smooth everywhere, no creases):
   * terracettes (soft sinusoidal steps following the contour lines, from the altitude
   * itself), gullies and rock ribs (narrow lines along a warped noise field), soft bumps.
   * Amplitudes per biome (data/biomes.ts), blended from forest to open steep meadow with the
   * altitude.
   */
  mesoRelief(x: number, z: number, h: number): number {
    const b = this.def.biomes;
    const open = clamp(
      (h - b.denseForestLine) / Math.max(1, b.treeLine - 80 - b.denseForestLine),
      0,
      1,
    );
    const R = this.reliefMix(open);
    const n = this.meso;
    // Terracettes: period 2.4 m of altitude (closer together on steeper ground), faded in
    // and out in patches; the amplitude is capped by the slope so the curvature stays
    // bounded (no creases on the steepest faces).
    const f = this.field;
    const sl =
      Math.hypot(f.sample(x + 3, z) - f.sample(x - 3, z), f.sample(x, z + 3) - f.sample(x, z - 3)) /
      6;
    const k = (2 * Math.PI * sl) / 2.4;
    const amp = Math.min(R.terracettes * 0.7, 0.45 / Math.max(1e-3, k * k));
    const t = h / 2.4 + 0.5 * n.noise(x / 37, z / 37);
    const terr =
      -amp * Math.sin(t * 2 * Math.PI) * smoothstep(-0.4, 0.3, n.noise(x / 90 + 3, z / 90));
    // Ribs (raised lines) and gullies (sunken lines) on a warped field: Gaussian profiles.
    const wx = x + 8 * n.noise(x / 70 - 7, z / 70 + 2);
    const wz = z + 8 * n.noise(x / 70 + 5, z / 70 - 4);
    const r = n.noise(wx / 46, wz / 46);
    const g = n.noise(wx / 38 + 31, wz / 38 - 17);
    const ribs = R.ribs * Math.exp(-(r * r) / 0.1);
    const gullies = R.gullies * Math.exp(-(g * g) / 0.09);
    const bumps = R.bumps * n.noise(x / 9, z / 9);
    return terr + ribs - gullies + bumps;
  }

  private readonly mesoMix = { terracettes: 0, gullies: 0, ribs: 0, bumps: 0 };
  private reliefMix(open: number): {
    terracettes: number;
    gullies: number;
    ribs: number;
    bumps: number;
  } {
    const a = biomes.forest.relief;
    const c = biomes.steepMeadow.relief;
    const o = this.mesoMix;
    o.terracettes = a.terracettes + (c.terracettes - a.terracettes) * open;
    o.gullies = a.gullies + (c.gullies - a.gullies) * open;
    o.ribs = a.ribs + (c.ribs - a.ribs) * open;
    o.bumps = a.bumps + (c.bumps - a.bumps) * open;
    return o;
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
   * Builds the rivers from the streams traced on the flow graph (spring → lake), with a
   * monotone bank altitude, and their spatial index. Must run before trails are routed.
   */
  buildRivers(): void {
    const d = this.def;
    const rivers: River[] = [];
    for (let k = 0; k < this.data.streams.length && k < d.rivers.length; k++) {
      const def = d.rivers[k];
      const sp = this.data.streams[k];
      const xs = Array.from(sp.x);
      const zs = Array.from(sp.z);
      if (xs.length < 4) continue;
      // Bank altitude: smoothed natural height, forced non-increasing (water flows down).
      const n = xs.length;
      const bank = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let cnt = 0;
        for (let o = -3; o <= 3; o++) {
          const j = clamp(i + o, 0, n - 1);
          sum += this.heightMacro(xs[j], zs[j]);
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
