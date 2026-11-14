import type { ResolvedPalette } from '../data/palette';
import type { PaletteKey } from '../data/types';
import { hash2 } from '../math/rng';
import type { Terrain, TrailGround } from './terrain';

/** Palette in transferable form: key → RGB triples of its tones (0..1). */
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

const TRAIL_KEY: Record<TrailGround, PaletteKey> = {
  dirt: 'trail',
  rut: 'wood',
  gravel: 'scree',
  grass: 'alpine',
  mud: 'wood',
  snow: 'snow',
  ford: 'sand',
};

/** Colours terrain vertices from the biome classification and the palette. */
export class TerrainColorer {
  constructor(
    private readonly terrain: Terrain,
    private readonly palette: PatchPalette,
  ) {}

  /** Writes the RGB colour of a vertex into out[o..o+2]. */
  vertex(v: VertexInfo, out: Float32Array, o: number): void {
    const t = this.terrain;
    const lake = t.mountain.def.lake.level;
    const tg = t.trailGround(v.trail, v.s, v.lateral, v.x, v.z, v.h);
    const key: PaletteKey = tg
      ? TRAIL_KEY[tg]
      : v.h < lake - 0.5
        ? 'sand'
        : t.classify(v.x, v.z, v.h, v.ny, v.roadDistance, v.halfWidth).key;
    const ramp = this.palette[key];
    const hsh = hash2(Math.floor(v.x * 0.37), Math.floor(v.z * 0.37), 11);
    const tone = hsh < (v.ny < 0.86 ? 0.7 : 0.35) ? 1 : 0;
    out[o] = ramp[tone * 3];
    out[o + 1] = ramp[tone * 3 + 1];
    out[o + 2] = ramp[tone * 3 + 2];
  }
}
