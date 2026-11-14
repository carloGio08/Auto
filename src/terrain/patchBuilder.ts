import { hash2 } from '../math/rng';
import type { Terrain } from './terrain';
import { TerrainColorer, type PatchPalette, type VertexInfo } from './splat';

/** A terrain patch to build: square of `n` × `n` cells starting at (x0, z0). */
export interface PatchRequest {
  key: number;
  /** Course generation (stale requests are dropped). */
  gen: number;
  x0: number;
  z0: number;
  size: number;
  n: number;
}

/**
 * Compact, non-indexed patch geometry. Positions are Int16 in patch-local units of
 * `unit` metres around (x0, originY, z0) – the mesh is translated and uniformly scaled –
 * colours are normalised Uint8 RGB and face normals normalised Int8.
 */
export interface PatchArrays {
  position: Int16Array;
  color: Uint8Array;
  normal: Int8Array;
  /** Vertices actually used (3 per triangle). */
  count: number;
  unit: number;
  originY: number;
  minY: number;
  maxY: number;
}

/** Recycled typed arrays, by length (patches of a world all have the same size). */
export class ArrayPool {
  private readonly i16 = new Map<number, Int16Array[]>();
  private readonly u8 = new Map<number, Uint8Array[]>();
  private readonly i8 = new Map<number, Int8Array[]>();

  give(r: Pick<PatchArrays, 'position' | 'color' | 'normal'>): void {
    const put = <T>(m: Map<number, T[]>, a: T, len: number): void => {
      const l = m.get(len) ?? [];
      if (l.length < 24) l.push(a);
      m.set(len, l);
    };
    put(this.i16, r.position, r.position.length);
    put(this.u8, r.color, r.color.length);
    put(this.i8, r.normal, r.normal.length);
  }

  takeI16(len: number): Int16Array {
    return this.i16.get(len)?.pop() ?? new Int16Array(len);
  }

  takeU8(len: number): Uint8Array {
    return this.u8.get(len)?.pop() ?? new Uint8Array(len);
  }

  takeI8(len: number): Int8Array {
    return this.i8.get(len)?.pop() ?? new Int8Array(len);
  }
}

/** Position quantum: 1/128 of a cell (≈ 8 mm at 1 m cells). */
export const UNITS_PER_CELL = 128;

const enum Phase {
  Heights,
  Colors,
  Mesh,
  Done,
}

/**
 * Builds one patch incrementally (row by row, so the main thread can time-slice it; the
 * worker just runs it to completion). Heights and trail data are sampled on an
 * (n + 3)² grid (one ring of margin for normals), colours per vertex, then each flat-shaded
 * face takes the mean colour of its corners with a small deterministic shade jitter.
 */
export class PatchBuild {
  private phase = Phase.Heights;
  private row = 0;
  private readonly m: number;
  private readonly H: Float32Array;
  private readonly info: Float32Array;
  private readonly C: Float32Array;
  private readonly cell: number;
  result: PatchArrays | null = null;
  private readonly colorer: TerrainColorer;
  private readonly v: VertexInfo = {
    x: 0,
    z: 0,
    h: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    roadDistance: 1e4,
    halfWidth: 0,
    lateral: 0,
    s: 0,
    trail: -1,
    curvature: 0,
  };

  constructor(
    private readonly terrain: Terrain,
    palette: PatchPalette,
    readonly req: PatchRequest,
    private readonly pool: ArrayPool | null = null,
  ) {
    this.m = req.n + 3;
    this.H = new Float32Array(this.m * this.m);
    // Per vertex: road distance, half width, lateral, s, trail.
    this.info = new Float32Array((req.n + 1) * (req.n + 1) * 5);
    this.C = new Float32Array((req.n + 1) * (req.n + 1) * 3);
    this.cell = req.size / req.n;
    this.colorer = new TerrainColorer(terrain, palette);
  }

  /** Advances until `deadline` (performance.now() ms); returns true when finished. */
  step(deadline: number): boolean {
    const { n } = this.req;
    const m = this.m;
    const cell = this.cell;
    const t = this.terrain;
    while (this.phase === Phase.Heights) {
      if (this.row >= m) {
        this.phase = Phase.Colors;
        this.row = 0;
        break;
      }
      const j = this.row - 1;
      const z = this.req.z0 + j * cell;
      const inner = j >= 0 && j <= n;
      for (let ii = 0; ii < m; ii++) {
        const i = ii - 1;
        const x = this.req.x0 + i * cell;
        this.H[this.row * m + ii] = t.height(x, z);
        if (inner && i >= 0 && i <= n) {
          const q = t.lastQuery;
          const o = (j * (n + 1) + i) * 5;
          this.info[o] = q.found ? q.distance : 1e4;
          this.info[o + 1] = q.found ? q.halfWidth : 0;
          this.info[o + 2] = q.found ? q.lateral : 0;
          this.info[o + 3] = q.found ? q.s : 0;
          this.info[o + 4] = q.found ? q.trail : -1;
        }
      }
      this.row++;
      if (performance.now() > deadline) return false;
    }
    while (this.phase === Phase.Colors) {
      if (this.row > n) {
        this.phase = Phase.Mesh;
        break;
      }
      const j = this.row;
      const v = this.v;
      const H = this.H;
      for (let i = 0; i <= n; i++) {
        const c = (j + 1) * m + (i + 1);
        const dx = H[c + 1] - H[c - 1];
        const dz = H[c + m] - H[c - m];
        const ln = Math.hypot(dx, 2 * cell, dz);
        v.x = this.req.x0 + i * cell;
        v.z = this.req.z0 + j * cell;
        v.h = H[c];
        v.nx = -dx / ln;
        v.ny = (2 * cell) / ln;
        v.nz = -dz / ln;
        v.curvature = (H[c + 1] + H[c - 1] + H[c + m] + H[c - m] - 4 * H[c]) / (cell * cell);
        const o = (j * (n + 1) + i) * 5;
        v.roadDistance = this.info[o];
        v.halfWidth = this.info[o + 1];
        v.lateral = this.info[o + 2];
        v.s = this.info[o + 3];
        v.trail = this.info[o + 4];
        this.colorer.vertex(v, this.C, (j * (n + 1) + i) * 3);
      }
      this.row++;
      if (performance.now() > deadline) return false;
    }
    if (this.phase === Phase.Mesh) {
      this.result = this.assemble();
      this.phase = Phase.Done;
    }
    return true;
  }

  private assemble(): PatchArrays {
    const { n, x0, z0 } = this.req;
    const m = this.m;
    const H = this.H;
    const C = this.C;
    const cell = this.cell;
    const unit = cell / UNITS_PER_CELL;
    const inv = 1 / unit;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const h = H[(j + 1) * m + i + 1];
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    const originY = Math.round((minY + maxY) / 2);
    const tris = n * n * 2 + n * 8;
    const pool = this.pool;
    const pos = pool ? pool.takeI16(tris * 9) : new Int16Array(tris * 9);
    const col = pool ? pool.takeU8(tris * 9) : new Uint8Array(tris * 9);
    const nor = pool ? pool.takeI8(tris * 9) : new Int8Array(tris * 9);
    let k = 0;
    const seed = 11;
    const hy = (h: number): number => Math.round((h - originY) * inv);
    const tri = (
      ai: number,
      aj: number,
      ay: number,
      bi: number,
      bj: number,
      by: number,
      ci: number,
      cj: number,
      cy: number,
      ca: number,
      cb: number,
      cc: number,
      skirt: boolean,
    ): void => {
      // Face normal in metres.
      const ux = (bi - ai) * cell;
      const uy = by - ay;
      const uz = (bj - aj) * cell;
      const vx = (ci - ai) * cell;
      const vy = cy - ay;
      const vz = (cj - aj) * cell;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      let ln = Math.hypot(nx, ny, nz) || 1;
      if (skirt) {
        // Skirts are lit like the ground above them, so LOD seams do not show as dark lines.
        const c = (aj + 1) * m + ai + 1;
        nx = H[c - 1] - H[c + 1];
        ny = 2 * cell;
        nz = H[c - m] - H[c + m];
        ln = Math.hypot(nx, ny, nz);
      }
      const p = k * 9;
      const U = UNITS_PER_CELL;
      pos[p] = ai * U;
      pos[p + 1] = hy(ay);
      pos[p + 2] = aj * U;
      pos[p + 3] = bi * U;
      pos[p + 4] = hy(by);
      pos[p + 5] = bj * U;
      pos[p + 6] = ci * U;
      pos[p + 7] = hy(cy);
      pos[p + 8] = cj * U;
      // Mean colour of the corners, with a tiny per-face shade step (stylised facets).
      const fx = x0 + ((ai + bi + ci) / 3) * cell;
      const fz = z0 + ((aj + bj + cj) / 3) * cell;
      const jit = skirt
        ? 1
        : 0.955 + 0.09 * hash2(Math.floor(fx * 1.7), Math.floor(fz * 1.7), seed);
      const r = Math.min(255, ((C[ca] + C[cb] + C[cc]) / 3) * jit * 255);
      const g = Math.min(255, ((C[ca + 1] + C[cb + 1] + C[cc + 1]) / 3) * jit * 255);
      const b = Math.min(255, ((C[ca + 2] + C[cb + 2] + C[cc + 2]) / 3) * jit * 255);
      const qx = Math.round((nx / ln) * 127);
      const qy = Math.round((ny / ln) * 127);
      const qz = Math.round((nz / ln) * 127);
      for (let v = 0; v < 3; v++) {
        col[p + v * 3] = r;
        col[p + v * 3 + 1] = g;
        col[p + v * 3 + 2] = b;
        nor[p + v * 3] = qx;
        nor[p + v * 3 + 1] = qy;
        nor[p + v * 3 + 2] = qz;
      }
      k++;
    };
    const hAt = (i: number, j: number): number => H[(j + 1) * m + i + 1];
    const cAt = (i: number, j: number): number => (j * (n + 1) + i) * 3;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h00 = hAt(i, j);
        const h10 = hAt(i + 1, j);
        const h01 = hAt(i, j + 1);
        const h11 = hAt(i + 1, j + 1);
        const c00 = cAt(i, j);
        const c10 = cAt(i + 1, j);
        const c01 = cAt(i, j + 1);
        const c11 = cAt(i + 1, j + 1);
        // Split along the diagonal that best follows the surface (fewer ridges across
        // valleys), alternating where it does not matter.
        const d1 = Math.abs(h00 - h11);
        const d2 = Math.abs(h10 - h01);
        const alt = d1 === d2 ? (i + j) % 2 === 0 : d1 > d2;
        if (alt) {
          tri(i, j, h00, i, j + 1, h01, i + 1, j, h10, c00, c01, c10, false);
          tri(i + 1, j, h10, i, j + 1, h01, i + 1, j + 1, h11, c10, c01, c11, false);
        } else {
          tri(i, j, h00, i, j + 1, h01, i + 1, j + 1, h11, c00, c01, c11, false);
          tri(i, j, h00, i + 1, j + 1, h11, i + 1, j, h10, c00, c11, c10, false);
        }
      }
    }
    // Skirts (outward facing) hide cracks between patches of different size.
    const depth = cell * 1.5 + 2;
    const skirt = (ai: number, aj: number, bi: number, bj: number): void => {
      const ha = hAt(ai, aj);
      const hb = hAt(bi, bj);
      const ca = cAt(ai, aj);
      const cb = cAt(bi, bj);
      tri(ai, aj, ha, bi, bj, hb, ai, aj, ha - depth, ca, cb, ca, true);
      tri(bi, bj, hb, bi, bj, hb - depth, ai, aj, ha - depth, cb, cb, ca, true);
    };
    for (let i = 0; i < n; i++) {
      skirt(i, 0, i + 1, 0);
      skirt(i + 1, n, i, n);
      skirt(0, i + 1, 0, i);
      skirt(n, i, n, i + 1);
    }
    return {
      position: pos,
      color: col,
      normal: nor,
      count: k * 3,
      unit,
      originY,
      minY: minY - depth,
      maxY,
    };
  }
}

/** Builds a whole patch at once (worker). */
export function buildPatch(
  terrain: Terrain,
  palette: PatchPalette,
  req: PatchRequest,
  pool: ArrayPool | null = null,
): PatchArrays {
  const b = new PatchBuild(terrain, palette, req, pool);
  b.step(Infinity);
  return b.result!;
}
