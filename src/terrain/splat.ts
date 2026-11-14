import type { ResolvedPalette } from '../data/palette';
import type { PaletteKey } from '../data/types';
import { hash2 } from '../math/rng';
import { Mat, MATERIALS } from './biome';
import type { Terrain, TrailGround } from './terrain';

/** Palette in transferable form: key → RGB triples of its tones (0..1, dark → light). */
export type PatchPalette = Record<string, Float32Array>;

export function toPatchPalette(p: ResolvedPalette): PatchPalette {
  const out: PatchPalette = {};
  for (const key of Object.keys(p) as PaletteKey[]) {
    const tones = p[key];
    const a = new Float32Array(tones.length * 3);
    tones.forEach((c, i) => {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    });
    out[key] = a;
  }
  return out;
}

/** Everything known about a terrain vertex when it is coloured. */
export interface VertexInfo {
  x: number;
  z: number;
  h: number;
  /** Unit normal. */
  nx: number;
  ny: number;
  nz: number;
  /** Laplacian of the height at the patch resolution (+ concave, − convex). */
  curvature: number;
  /** Closest trail: distance, half width, signed lateral offset, distance along, index. */
  roadDistance: number;
  halfWidth: number;
  lateral: number;
  s: number;
  trail: number;
}

/**
 * Tone bias per material (added to the shared patch noise): snow and dry grass lean light,
 * forest floor dark.
 */
const BIAS: number[] = [
  0.25, // snow
  0, // snowShade
  0, // snowRock
  0, // rockLight
  0, // rockDark
  0, // scree
  0, // rockGrass
  0, // earth
  0, // mud
  0, // sand
  0.05, // dryGrass
  0.05, // grass
  -0.15, // flowers (base greens; accents are specks)
  0, // undergrowth
  -0.05, // forest
  0, // moss
];

/**
 * Colours terrain vertices by splatting material ramps: weights from the biome model
 * (altitude, slope, aspect, curvature, wetness, snow line), each material's tone picked
 * continuously along its ramp by large-scale patches (2–3 greens in a meadow), curvature
 * (hollows darker) and wetness, then blended. The worn band of trails is mixed in with a
 * soft, irregular edge and its own surfaces (dirt, ruts, gravel, grassy middle, puddles,
 * snow, stones). Only palette colours are used.
 */
export class TerrainColorer {
  private readonly w = new Float32Array(Mat.Count);
  private readonly ramps: Float32Array[];
  private readonly c = new Float32Array(3);
  private readonly seed: number;

  constructor(
    private readonly terrain: Terrain,
    private readonly palette: PatchPalette,
  ) {
    this.ramps = MATERIALS.map((m) => palette[m]);
    this.seed = terrain.mountain.def.seed & 0xffff;
  }

  /** Adds `k` × the tone at t (0..1, continuous) of a ramp to the accumulator. */
  private add(ramp: Float32Array, t: number, k: number): void {
    const n = ramp.length / 3;
    const f = Math.max(0, Math.min(n - 1, t * (n - 1)));
    const i = Math.min(n - 2, Math.floor(f));
    const u = n > 1 ? f - i : 0;
    const a = i * 3;
    const b = Math.min(n - 1, i + 1) * 3;
    this.c[0] += (ramp[a] + (ramp[b] - ramp[a]) * u) * k;
    this.c[1] += (ramp[a + 1] + (ramp[b + 1] - ramp[a + 1]) * u) * k;
    this.c[2] += (ramp[a + 2] + (ramp[b + 2] - ramp[a + 2]) * u) * k;
  }

  /** Writes the RGB colour of a vertex into out[o..o+2]. */
  vertex(v: VertexInfo, out: Float32Array, o: number): void {
    const t = this.terrain;
    const road = t.road;
    const bio = t.biomes;
    // Position relative to the worn band of the closest trail.
    let latB = 0;
    let edge = -1;
    let g = -1;
    if (v.trail >= 0) {
      const tr = road.trails[v.trail];
      g = tr.start + Math.max(0, Math.min(tr.count - 1, Math.round(v.s / road.spacing)));
      latB = v.lateral - road.offset[g];
      edge = t.bandEdge(road.halfWidth[g], v.s, latB, v.x);
    }
    const roadEdge = g >= 0 ? Math.abs(latB) - edge : 1e4;
    const w = bio.weights({ x: v.x, z: v.z, h: v.h, ny: v.ny, nz: v.nz, roadEdge }, this.w);
    const P = bio.patchNoise(v.x, v.z);
    const cv = bio.curvature;
    const wet = bio.moisture;
    const c = this.c;
    c.fill(0);
    for (let i = 0; i < Mat.Count; i++) {
      const k = w[i];
      if (k < 0.004) continue;
      const tone = 0.5 + 0.36 * P + BIAS[i] - 0.18 * cv - (i >= Mat.DryGrass ? 0.2 * wet : 0);
      this.add(this.ramps[i], tone, k);
    }
    // Flower specks: yellow and pink accents in flowering meadows.
    if (w[Mat.Flowers] > 0.15) {
      const hsh = hash2(Math.floor(v.x * 1.3), Math.floor(v.z * 1.3), this.seed + 5);
      if (hsh < 0.16 * w[Mat.Flowers]) {
        const fl = this.ramps[Mat.Flowers];
        const acc = hsh < 0.08 * w[Mat.Flowers] ? 2 : 3;
        for (let j = 0; j < 3; j++) c[j] = c[j] * 0.45 + fl[acc * 3 + j] * 0.55;
      }
    }
    // The trail: soft irregular edge, then its own surface.
    if (g >= 0) {
      const inside = 1 - smooth(edge - 0.45, edge + 0.35, Math.abs(latB));
      if (inside > 0) {
        const kind = t.trailGround(v.trail, v.s, v.lateral, v.x, v.z, v.h, true);
        if (kind) {
          const r0 = c[0];
          const g0 = c[1];
          const b0 = c[2];
          c.fill(0);
          this.trailColor(kind, v, g, P);
          c[0] = r0 + (c[0] - r0) * inside;
          c[1] = g0 + (c[1] - g0) * inside;
          c[2] = b0 + (c[2] - b0) * inside;
        }
      }
    }
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
  }

  private trailColor(kind: TrailGround, v: VertexInfo, g: number, P: number): void {
    const pal = this.palette;
    // The worn surface changes tone every few tens of metres.
    const along =
      0.5 + 0.22 * Math.sin(v.s / 23 + v.trail * 1.7) + 0.14 * Math.sin(v.s / 7.3) + 0.12 * P;
    const stone = hash2(Math.floor(v.x * 2.1), Math.floor(v.z * 2.1), this.seed + 9) < 0.012;
    switch (kind) {
      case 'dirt':
        this.add(pal.earth, along + 0.1, stone ? 0.5 : 1);
        if (stone) this.add(pal.rockLight, 0.5, 0.5);
        break;
      case 'rut':
        this.add(pal.earth, along - 0.35, 1);
        break;
      case 'gravel':
        this.add(pal.scree, along + 0.1, 0.7);
        this.add(stone ? pal.rockDark : pal.rockLight, 0.6, 0.3);
        break;
      case 'grass':
        this.add(pal.dryGrass, along, 0.5);
        this.add(pal.grass, along, 0.5);
        break;
      case 'mud': {
        const deep = this.terrain.puddle(v.trail, v.s, v.lateral, this.terrain.road.surf[g]);
        this.add(pal.mud, 0.6 - deep * 0.5, 1 - deep * 0.45);
        this.add(pal.water, 0.3, deep * 0.45);
        break;
      }
      case 'snow':
        this.add(pal.snow, 0.35, 0.7);
        this.add(pal.snowShade, 0.6, 0.3);
        break;
      case 'ford':
        this.add(pal.scree, 0.25, 0.6);
        this.add(pal.sand, 0.3, 0.4);
        break;
    }
  }
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
