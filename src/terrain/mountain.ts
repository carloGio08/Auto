import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import type { RiverDef, TerrainDef } from '../data/types';

/**
 * The natural (un-carved) mountain: a long face descending along +Z into a lake valley,
 * framed by higher ridges on the sides. Pure function of (x, z) and the seed.
 */
export class Mountain {
  readonly def: TerrainDef;
  readonly river: RiverDef | undefined;
  private readonly noise: Simplex2;
  private readonly detail: Simplex2;
  readonly valleyHeight: number;
  readonly lakeCenterZ: number;
  /** Z where the face flattens into the valley (derived from the course end). */
  readonly faceLength: number;
  readonly peakAmplitude: number;
  private readonly riverPhase: number;
  readonly riverEndZ: number;
  private readonly riverFromZ: number;

  /**
   * @param endZ Z coordinate of the end of the course; the valley and the lake are placed
   *   right after it so every layout ends at the lake shore.
   */
  constructor(def: TerrainDef, seed: number, endZ: number, river?: RiverDef) {
    this.def = def;
    this.river = river;
    this.faceLength = endZ - 50;
    this.riverFromZ = river ? river.from * endZ : Infinity;
    this.noise = new Simplex2(seed);
    this.detail = new Simplex2(seed ^ 0x5bd1e995);
    this.valleyHeight = def.lakeLevel + 7;
    this.lakeCenterZ = endZ + def.lakeRadius * 0.95;
    this.riverPhase = (seed % 1000) * 0.01;
    this.riverEndZ = this.lakeCenterZ;
    const baseAtStart = this.base(0);
    this.peakAmplitude = Math.max(25, def.summitHeight - baseAtStart);
  }

  /** Fall-line profile: linear face that softly flattens into the valley. */
  private base(z: number): number {
    const k = 70;
    const u = (this.faceLength - z) / k;
    // softplus: ~u for large u, →0 for very negative u.
    const sp = u > 30 ? u : Math.log1p(Math.exp(u));
    return this.valleyHeight + this.def.slope * k * sp;
  }

  /** Natural height without the river channel (used to build the road profile). */
  heightNoChannel(x: number, z: number): number {
    const d = this.def;
    let h = this.base(z);
    // Summit dome behind/around the start.
    const px = x / 230;
    const pz = (z + 70) / 170;
    h += this.peakAmplitude * Math.exp(-(px * px + pz * pz));
    // Bowl: sides rise gently, then into high ridges framing the world.
    const ax = Math.abs(x);
    h += 48 * (x / 520) * (x / 520);
    h +=
      210 * smoothstep(480, 900, ax) * (0.65 + 0.35 * this.noise.ridged(x / 260 + 7.1, z / 260, 3));
    // Mountains closing the valley beyond the lake.
    h +=
      190 *
      smoothstep(this.lakeCenterZ + d.lakeRadius * 1.3, this.lakeCenterZ + d.lakeRadius * 2.6, z) *
      (0.6 + 0.4 * this.noise.ridged(x / 240, z / 240 + 3.3, 3));
    // Back wall behind the summit.
    h += 120 * smoothstep(-180, -520, z);
    // Ridges and broad undulations.
    h += d.ridgeAmplitude * (this.noise.ridged(x / 310, z / 310, 4) - 0.42);
    h += d.noiseAmplitude * this.noise.fbm(x / 130 + 31.7, z / 130 - 12.3, 4);
    h += 2.4 * this.detail.fbm(x / 36, z / 36, 2);
    // Lake basin.
    const lx = x / (d.lakeRadius * 1.25);
    const lz = (z - this.lakeCenterZ) / d.lakeRadius;
    const ld = Math.sqrt(lx * lx + lz * lz);
    h -= 16 * (1 - smoothstep(0.45, 1.05, ld));
    // Flatten the valley floor a little so the lake shore is readable.
    if (z > this.faceLength) {
      const flat =
        smoothstep(this.faceLength, this.faceLength + 160, z) * (1 - smoothstep(0.9, 1.6, ld));
      h += (d.lakeLevel + 2 - h) * 0.55 * flat * smoothstep(d.lakeLevel + 2, d.lakeLevel + 30, h);
    }
    return h;
  }

  /** X position of the river centre line at a given Z. */
  riverX(z: number): number {
    const r = this.river!;
    return (
      r.x +
      r.meander * Math.sin(z / 85 + this.riverPhase) +
      r.meander * 0.4 * Math.sin(z / 37 + 2.1)
    );
  }

  /** Strength of the river at Z (0 before the spring, 1 along the stream). */
  riverStrength(z: number): number {
    const r = this.river;
    if (!r) return 0;
    return (
      smoothstep(this.riverFromZ - 10, this.riverFromZ + 50, z) *
      (1 - smoothstep(this.riverEndZ - 40, this.riverEndZ, z))
    );
  }

  /** Approximate horizontal distance to the river centre line. */
  riverDistance(x: number, z: number): number {
    if (!this.river) return Infinity;
    const xr = this.riverX(z);
    const dxdz = (this.riverX(z + 1) - this.riverX(z - 1)) * 0.5;
    return Math.abs(x - xr) / Math.sqrt(1 + dxdz * dxdz);
  }

  /** Depth of the channel carved at (x,z). */
  channelDepth(x: number, z: number): number {
    const r = this.river;
    if (!r) return 0;
    const strength = this.riverStrength(z);
    if (strength <= 0) return 0;
    const d = this.riverDistance(x, z);
    const outer = r.width * 0.5 + 9;
    if (d >= outer) return 0;
    const t = 1 - smoothstep(r.width * 0.25, outer, d);
    return r.depth * t * strength;
  }

  /** Natural height including the river channel and lake basin. */
  height(x: number, z: number): number {
    return this.heightNoChannel(x, z) - this.channelDepth(x, z);
  }

  /** Water surface height at (x,z), or -Infinity when there is no water there. */
  waterLevel(x: number, z: number): number {
    let level = -Infinity;
    if (this.river) {
      const strength = this.riverStrength(z);
      if (strength > 0.2 && this.riverDistance(x, z) < this.river.width * 0.5 + 1) {
        level =
          this.heightNoChannel(this.riverX(z), z) -
          this.river.depth * strength +
          this.river.depth * 0.42;
      }
    }
    return Math.max(level, this.def.lakeLevel);
  }
}
