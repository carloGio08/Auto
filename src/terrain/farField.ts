import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import type { Course } from './course';
import { heightmapHalfExtent } from './generator';
import { LandformField } from './landforms';
import type { PatchPalette } from './splat';

/** A far-field ring request: the quadtree covers |x|, |z| < hole. */
export interface FarFieldRequest {
  hole: number;
  /** Target grid spacing (m) and half extent (m). */
  spacing: number;
  extent: number;
}

/** Indexed far-field mesh (one draw call, flat shaded from derivatives). */
export interface FarFieldArrays {
  position: Float32Array;
  color: Uint8Array;
  index: Uint32Array;
}

/**
 * Height of the far terrain: the real terrain (heightmap, same as the quadtree) near the
 * map, then the same landform definitions evaluated analytically with the distant ranges of
 * the mountain added (`farRanges`), plus a broad ridged noise far out for varied skylines.
 */
export class FarHeight {
  private readonly field: LandformField;
  private readonly noise: Simplex2;
  private readonly inner: number;
  private readonly outer: number;

  /** @param hole half size of the quadtree area: the real terrain is kept up to past it. */
  constructor(
    private readonly course: Course,
    hole = 0,
  ) {
    const def = course.def;
    this.field = new LandformField({
      ...def,
      landforms: [...def.landforms, ...(def.farRanges ?? [])],
    });
    this.noise = new Simplex2(def.seed ^ 0xfa4f);
    this.outer = heightmapHalfExtent(def) - 20;
    this.inner = Math.min(this.outer - 60, Math.max(hole + 40, this.outer - 400));
  }

  height(x: number, z: number): number {
    const r = Math.max(Math.abs(x), Math.abs(z));
    if (r < this.inner) return this.course.terrain.height(x, z);
    let h = this.field.height(x, z);
    const far = smoothstep(6000, 10000, r);
    if (far > 0) h += 480 * far * this.noise.ridged(x / 3800, z / 3800, 3) - 150 * far;
    if (r >= this.outer) return h;
    const t = smoothstep(this.inner, this.outer, r);
    return this.course.terrain.height(x, z) * (1 - t) + h * t;
  }
}

/**
 * Builds the far-field ring: a square grid from the quadtree's edge out to `extent`, aligned
 * so the edge falls on grid lines (cells are either outside the quadtree or skipped), with
 * vertex colours by altitude and slope from the palette (snow, rock, forest, meadow).
 */
export function buildFarField(
  course: Course,
  palette: PatchPalette,
  req: FarFieldRequest,
): FarFieldArrays {
  const fh = new FarHeight(course, req.hole);
  const k = Math.max(1, Math.round(req.hole / req.spacing));
  const s = req.hole / k;
  const half = Math.ceil(req.extent / s);
  const n = half * 2 + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Uint8Array(n * n * 3);
  const H = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i - half) * s;
      const z = (j - half) * s;
      const inside = Math.abs(i - half) < k && Math.abs(j - half) < k;
      H[j * n + i] = inside ? 0 : fh.height(x, z);
    }
  const def = course.def;
  const b = def.biomes;
  const tone = (ramp: Float32Array, t: number, out: number[]): void => {
    const m = ramp.length / 3;
    const f = Math.max(0, Math.min(m - 1, t * (m - 1)));
    const a = Math.floor(f);
    const c = Math.min(m - 1, a + 1);
    const u = f - a;
    for (let q = 0; q < 3; q++) out[q] = ramp[a * 3 + q] * (1 - u) + ramp[c * 3 + q] * u;
  };
  const tmp = [0, 0, 0];
  const acc = [0, 0, 0];
  const add = (w: number): void => {
    acc[0] += tmp[0] * w;
    acc[1] += tmp[1] * w;
    acc[2] += tmp[2] * w;
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const h = H[c];
      pos[c * 3] = (i - half) * s;
      pos[c * 3 + 1] = h;
      pos[c * 3 + 2] = (j - half) * s;
      const il = Math.max(0, i - 1);
      const ir = Math.min(n - 1, i + 1);
      const jl = Math.max(0, j - 1);
      const jr = Math.min(n - 1, j + 1);
      const slope =
        Math.hypot(H[j * n + ir] - H[j * n + il], H[jr * n + i] - H[jl * n + i]) / (2 * s);
      acc[0] = acc[1] = acc[2] = 0;
      const snow =
        smoothstep(b.snowLine - 150, b.snowLine + 250, h) * (1 - smoothstep(0.7, 1.1, slope));
      const rock = Math.min(
        1 - snow,
        smoothstep(0.45, 0.9, slope) + smoothstep(b.rockLine, b.snowLine, h) * 0.6,
      );
      const veg = Math.max(0, 1 - snow - rock);
      const forest = veg * (1 - smoothstep(b.treeLine - 200, b.treeLine + 100, h)) * 0.75;
      tone(palette.snow, 0.7, tmp);
      add(snow);
      tone(palette.rockLight, 0.4, tmp);
      add(rock * 0.6);
      tone(palette.rockDark, 0.6, tmp);
      add(rock * 0.4);
      tone(palette.forest, 0.6, tmp);
      add(forest);
      tone(palette.grass, 0.5, tmp);
      add(veg - forest);
      col[c * 3] = Math.min(255, acc[0] * 255);
      col[c * 3 + 1] = Math.min(255, acc[1] * 255);
      col[c * 3 + 2] = Math.min(255, acc[2] * 255);
    }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      // Skip the cells covered by the quadtree.
      const ci = i - half + 0.5;
      const cj = j - half + 0.5;
      if (Math.abs(ci) < k && Math.abs(cj) < k) continue;
      const a = j * n + i;
      const d1 = Math.abs(H[a] - H[a + n + 1]);
      const d2 = Math.abs(H[a + 1] - H[a + n]);
      if (d1 < d2) idx.push(a, a + n, a + n + 1, a, a + n + 1, a + 1);
      else idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  return { position: pos, color: col, index: Uint32Array.from(idx) };
}
