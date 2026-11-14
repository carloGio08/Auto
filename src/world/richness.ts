import { biomes, BIOME_IDS, richnessRules as R, type BiomeDef } from '../data/biomes';
import type { Course } from '../terrain/course';
import type { TerrainColorer, VertexInfo } from '../terrain/splat';

/** Floats per richness record (one per ~32 m cell of a cover tile). */
export const RICH_STRIDE = 11;
/**
 * Record layout: 0 biome index, 1 score (0..1), 2 variety, 3 density, 4 colour, 5 relief
 * (component scores 0..1), 6 instances, 7 kinds, 8 colour std (0..255), 9 relief std (m),
 * 10 filler instances added.
 */
export const RICH = {
  biome: 0,
  score: 1,
  variety: 2,
  density: 3,
  colour: 4,
  relief: 5,
  count: 6,
  types: 7,
  colourStd: 8,
  reliefStd: 9,
  filler: 10,
} as const;

const N = 9;
const hs = new Float64Array(N * N);
const vi: VertexInfo = {
  x: 0,
  z: 0,
  h: 0,
  nx: 0,
  ny: 1,
  nz: 0,
  curvature: 0,
  roadDistance: 1e4,
  halfWidth: 0,
  lateral: 0,
  s: 0,
  trail: -1,
};
const rgb = new Float32Array(3);

/**
 * Relief of a cell: residual standard deviation (m) of the least-squares plane through a
 * 9 × 9 grid of heights, and the plane's slope (rise / run).
 */
export function cellRelief(
  course: Course,
  x0: number,
  z0: number,
  size: number,
): { std: number; slope: number; flat: number } {
  const t = course.terrain;
  const step = size / (N - 1);
  let sx = 0;
  let sz = 0;
  let sh = 0;
  let sxx = 0;
  let szz = 0;
  let sxh = 0;
  let szh = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = i * step - size / 2;
      const v = j * step - size / 2;
      const h = t.height(x0 + i * step, z0 + j * step);
      hs[j * N + i] = h;
      sx += u;
      sz += v;
      sh += h;
      sxx += u * u;
      szz += v * v;
      sxh += u * h;
      szh += v * h;
    }
  const n = N * N;
  // Centred grid: the cross terms vanish, so the fit separates per axis.
  const mh = sh / n;
  const a = (sxh - (sx * sh) / n) / (sxx - (sx * sx) / n);
  const b = (szh - (sz * sh) / n) / (szz - (sz * sz) / n);
  let ss = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = i * step - size / 2;
      const v = j * step - size / 2;
      const r = hs[j * N + i] - (mh + a * u + b * v);
      ss += r * r;
    }
  const flat = course.mountain.field.flat(x0 + size / 2, z0 + size / 2);
  return { std: Math.sqrt(ss / n), slope: Math.hypot(a, b), flat };
}

/** Standard deviation (0..255, mean over channels) of the ground colour on a 4 × 4 grid. */
export function cellColourStd(
  course: Course,
  colorer: TerrainColorer,
  x0: number,
  z0: number,
  size: number,
): number {
  const t = course.terrain;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  const M = 4;
  for (let j = 0; j < M; j++)
    for (let i = 0; i < M; i++) {
      const x = x0 + ((i + 0.5) * size) / M;
      const z = z0 + ((j + 0.5) * size) / M;
      vi.x = x;
      vi.z = z;
      vi.h = t.height(x, z);
      const q = t.lastQuery;
      vi.trail = q.found ? q.trail : -1;
      vi.lateral = q.found ? q.lateral : 0;
      vi.s = q.found ? q.s : 0;
      vi.halfWidth = q.found ? q.halfWidth : 0;
      vi.roadDistance = q.found ? q.distance : 1e4;
      const dx = t.height(x + 1, z) - t.height(x - 1, z);
      const dz = t.height(x, z + 1) - t.height(x, z - 1);
      const l = Math.hypot(dx, 2, dz);
      vi.nx = -dx / l;
      vi.ny = 2 / l;
      vi.nz = -dz / l;
      colorer.vertex(vi, rgb, 0);
      s0 += rgb[0];
      s1 += rgb[1];
      s2 += rgb[2];
      q0 += rgb[0] * rgb[0];
      q1 += rgb[1] * rgb[1];
      q2 += rgb[2] * rgb[2];
    }
  const n = M * M;
  const v =
    Math.max(0, q0 / n - (s0 / n) ** 2) +
    Math.max(0, q1 / n - (s1 / n) ** 2) +
    Math.max(0, q2 / n - (s2 / n) ** 2);
  return Math.sqrt(v / 3) * 255;
}

/** Instances a biome needs in a cell of `area` m² at a preset density. */
export const minCount = (b: BiomeDef, area: number, density: number): number =>
  Math.ceil((b.richness.minDensity * area * density) / 100);
export const maxCount = (b: BiomeDef, area: number, density: number): number =>
  Math.floor((b.richness.maxDensity * area * Math.max(density, 0.3)) / 100);
/** Kinds a biome needs in a cell (never more than it has). */
export const minTypes = (b: BiomeDef): number => Math.min(b.richness.minTypes, b.props.length);

/**
 * Richness score of a cell (0..1): weighted mix of prop variety (kinds / required kinds),
 * density (instances / biome minimum), ground colour variation (std within the target
 * range) and relief (plane-fit residual on 15–40° slopes outside the declared flats).
 * Writes the record into `out` at `o`.
 */
export function scoreCell(
  biome: number,
  count: number,
  types: number,
  colourStd: number,
  relief: { std: number; slope: number; flat: number },
  area: number,
  density: number,
  filler: number,
  out: Float32Array,
  o: number,
): number {
  const b = biomes[BIOME_IDS[biome]];
  const need = Math.max(1, minCount(b, area, density));
  const variety = Math.min(1, types / Math.max(1, minTypes(b)));
  const dens = b.richness.minDensity <= 0 ? 1 : Math.min(1, count / need);
  const [lo, hi] = R.colourStd;
  const colour = colourStd < lo ? colourStd / lo : colourStd > hi ? hi / colourStd : 1;
  const onSlope = relief.slope >= R.slopeBand[0] && relief.slope <= R.slopeBand[1];
  const rel = onSlope && relief.flat < 0.5 ? Math.min(1, relief.std / R.reliefStd) : 1;
  const w = R.weights;
  const score = w.variety * variety + w.density * dens + w.colour * colour + w.relief * rel;
  out[o + RICH.biome] = biome;
  out[o + RICH.score] = score;
  out[o + RICH.variety] = variety;
  out[o + RICH.density] = dens;
  out[o + RICH.colour] = colour;
  out[o + RICH.relief] = rel;
  out[o + RICH.count] = count;
  out[o + RICH.types] = types;
  out[o + RICH.colourStd] = colourStd;
  out[o + RICH.reliefStd] = relief.std;
  out[o + RICH.filler] = filler;
  return score;
}
