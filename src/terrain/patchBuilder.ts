import { config } from '../config';
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
  /** Refine steep edges (finest level only: far away the shape of faces does not show). */
  refine?: boolean;
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

/** Arrays are pooled in buckets of this many floats (patches vary in triangle count). */
const BUCKET = 9 * 2048;
const bucket = (len: number): number => Math.ceil(len / BUCKET) * BUCKET;

/** Recycled typed arrays, by bucketed length. */
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
    const b = bucket(len);
    return this.i16.get(b)?.pop() ?? new Int16Array(b);
  }

  takeU8(len: number): Uint8Array {
    const b = bucket(len);
    return this.u8.get(b)?.pop() ?? new Uint8Array(b);
  }

  takeI8(len: number): Int8Array {
    const b = bucket(len);
    return this.i8.get(b)?.pop() ?? new Int8Array(b);
  }
}

/** Position quantum: 1/128 of a cell (≈ 8 mm at 1 m cells). */
export const UNITS_PER_CELL = 128;

/** Cell edges steeper than this (rise/run, ≈ 25°) get a midpoint on the surface. */
export const STEEP_SPLIT = Math.tan((25 * Math.PI) / 180);

const enum Phase {
  Heights,
  Colors,
  Mesh,
  Done,
}

/**
 * Deterministic XZ jitter (fraction of a cell, ±`config.world.terrainJitter`) of a grid
 * vertex, from its global grid index at this level: identical in every patch sharing it.
 */
export function vertexJitter(gi: number, gj: number, cell: number, axis: 0 | 1): number {
  const seed = 977 + Math.round(cell * 16) * 7 + axis * 131;
  return (hash2(gi, gj, seed) - 0.5) * 2 * config.world.terrainJitter * cell;
}

/**
 * Builds one patch incrementally (row by row, so the main thread can time-slice it; the
 * worker just runs it to completion).
 *
 * - Vertices sit on a regular grid moved by a deterministic XZ jitter (up to 25 % of the
 *   cell, only along the border on patch edges so neighbours match) and on the true surface
 *   (`terrain.height` at the jittered point): no visible stripes, negligible error.
 * - Heights and trail data use an (n + 3)² grid (one ring of margin), colours are computed
 *   per vertex (splat + baked occlusion).
 * - Flat quads are split along the diagonal giving the better shaped triangles (ties: the
 *   one along the contour lines). Edges steeper than ~25° get a midpoint on the surface and
 *   their cells a centre vertex, fanned into 5–8 triangles: faces stay small and well shaped
 *   on steep ground, and neighbours agree on every split edge (no cracks).
 * - Flat-shaded faces take the mean colour of their corners: no per-face noise.
 */
export class PatchBuild {
  private phase = Phase.Heights;
  private row = 0;
  private readonly m: number;
  private readonly H: Float32Array;
  /** Jittered XZ offsets of the inner vertices, (n + 1)². */
  private readonly JX: Float32Array;
  private readonly JZ: Float32Array;
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
    const n = req.n;
    this.m = n + 3;
    this.H = new Float32Array(this.m * this.m);
    this.JX = new Float32Array((n + 1) * (n + 1));
    this.JZ = new Float32Array((n + 1) * (n + 1));
    // Per vertex: road distance, half width, lateral, s, trail.
    this.info = new Float32Array((n + 1) * (n + 1) * 5);
    this.C = new Float32Array((n + 1) * (n + 1) * 3);
    this.cell = req.size / n;
    this.colorer = new TerrainColorer(terrain, palette);
    const cell = this.cell;
    const gi0 = Math.round(req.x0 / cell);
    const gj0 = Math.round(req.z0 / cell);
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i;
        // Border vertices only slide along the border (shared with the neighbour patch).
        this.JX[k] = i === 0 || i === n ? 0 : vertexJitter(gi0 + i, gj0 + j, cell, 0);
        this.JZ[k] = j === 0 || j === n ? 0 : vertexJitter(gi0 + i, gj0 + j, cell, 1);
      }
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
      const inner = j >= 0 && j <= n;
      for (let ii = 0; ii < m; ii++) {
        const i = ii - 1;
        let x = this.req.x0 + i * cell;
        let z = this.req.z0 + j * cell;
        const innerV = inner && i >= 0 && i <= n;
        const k = j * (n + 1) + i;
        if (innerV) {
          x += this.JX[k];
          z += this.JZ[k];
        }
        this.H[this.row * m + ii] = t.height(x, z);
        if (innerV) {
          const q = t.lastQuery;
          const o = k * 5;
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
        const k = j * (n + 1) + i;
        const dx = H[c + 1] - H[c - 1];
        const dz = H[c + m] - H[c - m];
        const ln = Math.hypot(dx, 2 * cell, dz);
        v.x = this.req.x0 + i * cell + this.JX[k];
        v.z = this.req.z0 + j * cell + this.JZ[k];
        v.h = H[c];
        v.nx = -dx / ln;
        v.ny = (2 * cell) / ln;
        v.nz = -dz / ln;
        v.curvature = (H[c + 1] + H[c - 1] + H[c + m] + H[c - m] - 4 * H[c]) / (cell * cell);
        const o = k * 5;
        v.roadDistance = this.info[o];
        v.halfWidth = this.info[o + 1];
        v.lateral = this.info[o + 2];
        v.s = this.info[o + 3];
        v.trail = this.info[o + 4];
        this.colorer.vertex(v, this.C, k * 3);
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
    const JX = this.JX;
    const JZ = this.JZ;
    const cell = this.cell;
    const unit = cell / UNITS_PER_CELL;
    const inv = 1 / unit;
    const n1 = n + 1;
    const hAt = (i: number, j: number): number => H[(j + 1) * m + i + 1];
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const h = hAt(i, j);
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    // Edges steeper than ~25° get a midpoint on the surface. The decision belongs to the
    // edge, so both cells (and both patches) sharing it agree: no cracks. Count the extra
    // triangles to size the arrays.
    const lim = this.req.refine === false ? Infinity : STEEP_SPLIT * cell;
    const splitH = new Uint8Array(n * (n + 1)); // (i, j)–(i + 1, j), index j * n + i
    const splitV = new Uint8Array((n + 1) * n); // (i, j)–(i, j + 1), index j * (n + 1) + i
    for (let j = 0; j <= n; j++)
      for (let i = 0; i < n; i++)
        if (Math.abs(hAt(i + 1, j) - hAt(i, j)) > lim) splitH[j * n + i] = 1;
    for (let j = 0; j < n; j++)
      for (let i = 0; i <= n; i++)
        if (Math.abs(hAt(i, j + 1) - hAt(i, j)) > lim) splitV[j * (n + 1) + i] = 1;
    let extra = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const m4 =
          splitH[j * n + i] +
          splitH[(j + 1) * n + i] +
          splitV[j * (n + 1) + i] +
          splitV[j * (n + 1) + i + 1];
        if (m4) extra += 2 + m4;
      }
    const originY = Math.round((minY + maxY) / 2);
    const tris = n * n * 2 + extra + n * 8;
    const pool = this.pool;
    const pos = pool ? pool.takeI16(tris * 9) : new Int16Array(tris * 9);
    const col = pool ? pool.takeU8(tris * 9) : new Uint8Array(tris * 9);
    const nor = pool ? pool.takeI8(tris * 9) : new Int8Array(tris * 9);
    let k = 0;
    const U = UNITS_PER_CELL;
    // Scratch vertex: local x, z (units), height (m), colour.
    // Slots: 0 = 00, 1 = 10, 2 = 01, 3 = 11, 4 = centre, 5..8 = edge midpoints.
    const P = new Float64Array(9 * 6);
    const setV = (slot: number, i: number, j: number): void => {
      const q = j * n1 + i;
      const o = slot * 6;
      P[o] = i * U + JX[q] * inv;
      P[o + 1] = j * U + JZ[q] * inv;
      P[o + 2] = hAt(i, j);
      P[o + 3] = C[q * 3];
      P[o + 4] = C[q * 3 + 1];
      P[o + 5] = C[q * 3 + 2];
    };
    const tri = (a: number, b: number, c: number, nrm: Float64Array | null): void => {
      const A = a * 6;
      const B = b * 6;
      const Cc = c * 6;
      // Face normal in metres.
      const ux = (P[B] - P[A]) * unit;
      const uy = P[B + 2] - P[A + 2];
      const uz = (P[B + 1] - P[A + 1]) * unit;
      const vx = (P[Cc] - P[A]) * unit;
      const vy = P[Cc + 2] - P[A + 2];
      const vz = (P[Cc + 1] - P[A + 1]) * unit;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      if (nrm) {
        nx = nrm[0];
        ny = nrm[1];
        nz = nrm[2];
      }
      const ln = Math.hypot(nx, ny, nz) || 1;
      const p = k * 9;
      for (let v = 0; v < 3; v++) {
        const o = v === 0 ? A : v === 1 ? B : Cc;
        pos[p + v * 3] = Math.round(P[o]);
        pos[p + v * 3 + 1] = Math.round((P[o + 2] - originY) * inv);
        pos[p + v * 3 + 2] = Math.round(P[o + 1]);
      }
      const r = Math.min(255, ((P[A + 3] + P[B + 3] + P[Cc + 3]) / 3) * 255);
      const g = Math.min(255, ((P[A + 4] + P[B + 4] + P[Cc + 4]) / 3) * 255);
      const bl = Math.min(255, ((P[A + 5] + P[B + 5] + P[Cc + 5]) / 3) * 255);
      const qx = Math.round((nx / ln) * 127);
      const qy = Math.round((ny / ln) * 127);
      const qz = Math.round((nz / ln) * 127);
      for (let v = 0; v < 3; v++) {
        col[p + v * 3] = r;
        col[p + v * 3 + 1] = g;
        col[p + v * 3 + 2] = bl;
        nor[p + v * 3] = qx;
        nor[p + v * 3 + 1] = qy;
        nor[p + v * 3 + 2] = qz;
      }
      k++;
    };
    const t = this.terrain;
    // Aspect of a scratch triangle in metres (longest edge × it / 2·area; 1.15 equilateral).
    const shape = (a: number, b: number, c: number): number => {
      const A = a * 6;
      const B = b * 6;
      const Cc = c * 6;
      const ux = (P[B] - P[A]) * unit;
      const uy = P[B + 2] - P[A + 2];
      const uz = (P[B + 1] - P[A + 1]) * unit;
      const vx = (P[Cc] - P[A]) * unit;
      const vy = P[Cc + 2] - P[A + 2];
      const vz = (P[Cc + 1] - P[A + 1]) * unit;
      const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const l1 = ux * ux + uy * uy + uz * uz;
      const l2 = vx * vx + vy * vy + vz * vz;
      const wx = vx - ux;
      const wy = vy - uy;
      const wz = vz - uz;
      const l3 = wx * wx + wy * wy + wz * wz;
      return Math.max(l1, l2, l3) / (area2 || 1e-9);
    };
    // Midpoint of two scratch vertices (a before b in grid order) on the true surface.
    const mid = (slot: number, a: number, b: number, on: number): void => {
      if (!on) return;
      const o = slot * 6;
      const A = a * 6;
      const B = b * 6;
      P[o] = (P[A] + P[B]) / 2;
      P[o + 1] = (P[A + 1] + P[B + 1]) / 2;
      P[o + 2] = t.height(x0 + P[o] * unit, z0 + P[o + 1] * unit);
      for (let c = 3; c < 6; c++) P[o + c] = (P[A + c] + P[B + c]) / 2;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        setV(0, i, j); // 00
        setV(1, i + 1, j); // 10
        setV(2, i, j + 1); // 01
        setV(3, i + 1, j + 1); // 11
        const sB = splitH[j * n + i];
        const sT = splitH[(j + 1) * n + i];
        const sL = splitV[j * (n + 1) + i];
        const sR = splitV[j * (n + 1) + i + 1];
        if (sB + sT + sL + sR) {
          // Steep cell: centre vertex and midpoints of the steep edges on the true surface,
          // fanned around the boundary (colours are means of the corners).
          mid(5, 0, 1, sB);
          mid(6, 1, 3, sR);
          mid(7, 2, 3, sT);
          mid(8, 0, 2, sL);
          const o = 4 * 6;
          P[o] = (P[0] + P[6] + P[12] + P[18]) / 4;
          P[o + 1] = (P[1] + P[7] + P[13] + P[19]) / 4;
          P[o + 2] = t.height(x0 + P[o] * unit, z0 + P[o + 1] * unit);
          for (let c = 3; c < 6; c++) P[o + c] = (P[c] + P[6 + c] + P[12 + c] + P[18 + c]) / 4;
          // Boundary loop: 00 → (bottom) → 10 → (right) → 11 → (top) → 01 → (left) → 00.
          let prev = 0;
          const step = (next: number): void => {
            tri(prev, 4, next, null);
            prev = next;
          };
          if (sB) step(5);
          step(1);
          if (sR) step(6);
          step(3);
          if (sT) step(7);
          step(2);
          if (sL) step(8);
          step(0);
          continue;
        }
        // Diagonal: the one giving the better shaped triangles in 3D (no slivers), and on a
        // tie the one joining the closest heights, along the contour lines.
        const q1 = Math.max(shape(0, 2, 3), shape(0, 3, 1));
        const q2 = Math.max(shape(0, 2, 1), shape(1, 2, 3));
        const d1 = Math.abs(P[2] - P[20]);
        const d2 = Math.abs(P[8] - P[14]);
        const alt =
          Math.abs(q1 - q2) > 0.1 * Math.min(q1, q2)
            ? q1 > q2
            : d1 === d2
              ? (i + j) % 2 === 0
              : d1 > d2;
        if (alt) {
          tri(0, 2, 1, null);
          tri(1, 2, 3, null);
        } else {
          tri(0, 2, 3, null);
          tri(0, 3, 1, null);
        }
      }
    }
    // Skirts (outward facing) hide cracks between patches of different size; lit like the
    // ground above them so LOD seams do not show as dark lines.
    const depth = cell * 1.5 + 2;
    const nrm = new Float64Array(3);
    const skirt = (ai: number, aj: number, bi: number, bj: number): void => {
      setV(0, ai, aj);
      setV(1, bi, bj);
      for (let c = 0; c < 6; c++) {
        P[12 + c] = P[c];
        P[18 + c] = P[6 + c];
      }
      P[14] -= depth;
      P[20] -= depth;
      const cc = (aj + 1) * m + ai + 1;
      nrm[0] = H[cc - 1] - H[cc + 1];
      nrm[1] = 2 * cell;
      nrm[2] = H[cc - m] - H[cc + m];
      tri(0, 1, 2, nrm);
      tri(1, 3, 2, nrm);
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
