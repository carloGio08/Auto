import type { ResolvedPalette } from '../data/palette';
import type { PaletteKey } from '../data/types';
import { config } from '../config';
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

  constructor(
    private readonly terrain: Terrain,
    private readonly palette: PatchPalette,
  ) {
    this.ramps = MATERIALS.map((m) => palette[m]);
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
    // Materials use the ground slope over ±3 m, the same at every LOD: no flicker between
    // neighbouring vertices from the fine detail, no colour pop between LODs.
    const e = 3;
    const gx = t.height(v.x + e, v.z) - t.height(v.x - e, v.z);
    const gz = t.height(v.x, v.z + e) - t.height(v.x, v.z - e);
    const gl = Math.hypot(gx, 2 * e, gz);
    const w = bio.weights(
      { x: v.x, z: v.z, h: v.h, ny: (2 * e) / gl, nz: -gz / gl, roadEdge },
      this.w,
    );
    // Tone patches: large (~200 m, ~60 m) and small (~10–40 m), all low frequency, so
    // neighbouring faces only step to adjacent tones of a ramp.
    const P = bio.patchNoise(v.x, v.z) + 0.35 * bio.fineNoise(v.x, v.z);
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
    // Baked ambient occlusion: hollows, the foot of slopes and the trail edges are darker.
    const ao = this.occlusion(v.x, v.z, roadEdge);
    out[o] = c[0] * ao;
    out[o + 1] = c[1] * ao;
    out[o + 2] = c[2] * ao;
  }

  /**
   * Ambient occlusion factor in [1 − strength, 1]: compares the height with the mean of two
   * rings of the heightmap (6 samples each) – ground lower than its surroundings sees less
   * sky – and darkens the 1–2 m beside the worn band of trails.
   */
  occlusion(x: number, z: number, roadEdge: number): number {
    const ao = config.world.ao;
    if (ao.strength <= 0) return 1;
    const f = this.terrain.mountain.field;
    const h = f.sample(x, z);
    let occ = 0;
    for (let r = 0; r < ao.radii.length; r++) {
      const R = ao.radii[r];
      let sum = 0;
      for (let k = 0; k < 6; k++) sum += f.sample(x + RING_X[k] * R, z + RING_Z[k] * R);
      occ += Math.max(0, sum / 6 - h) / R;
    }
    occ *= 1.6;
    if (roadEdge > -0.6 && roadEdge < 1.6) {
      const u = (roadEdge - 0.5) / 1.1;
      occ += 0.45 * (1 - u * u);
    }
    return 1 - ao.strength * Math.min(1, occ);
  }

  private trailColor(kind: TrailGround, v: VertexInfo, g: number, P: number): void {
    const pal = this.palette;
    // The worn surface changes tone every few tens of metres.
    const along =
      0.5 + 0.22 * Math.sin(v.s / 23 + v.trail * 1.7) + 0.14 * Math.sin(v.s / 7.3) + 0.12 * P;
    switch (kind) {
      case 'dirt':
        this.add(pal.earth, along + 0.1, 1);
        break;
      case 'rut':
        this.add(pal.earth, along - 0.35, 1);
        break;
      case 'gravel':
        this.add(pal.scree, along + 0.1, 0.7);
        this.add(pal.rockLight, 0.6, 0.3);
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

const RING_X = Array.from({ length: 6 }, (_, k) => Math.cos((k * Math.PI) / 3));
const RING_Z = Array.from({ length: 6 }, (_, k) => Math.sin((k * Math.PI) / 3));

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
