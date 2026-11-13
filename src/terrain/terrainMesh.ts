import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Texture,
} from 'three';
import { config } from '../config';
import { hash2 } from '../math/rng';
import { clamp, lerp, smoothstep } from '../math/util';
import type { Terrain } from './terrain';

interface Chunk {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  lods: (Mesh | null)[];
  current: number;
}

const PALETTE = {
  snow: new Color('#eef3f8'),
  snowShade: new Color('#cdd9e6'),
  rock: new Color('#7f7a73'),
  rockDark: new Color('#5d5852'),
  alpine: new Color('#8aa456'),
  grass: new Color('#679440'),
  forest: new Color('#4b7a35'),
  dirt: new Color('#9a7552'),
  sand: new Color('#d3bd8a'),
  lakebed: new Color('#6f8064'),
};

const tmp = new Color();
const tmp2 = new Color();

/**
 * Streams terrain chunks with three levels of detail around the camera. Geometry is
 * flat-shaded (non-indexed) with per-face colours from altitude, slope and road proximity.
 */
export class TerrainMesh {
  readonly group = new Group();
  readonly material: MeshLambertMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly size = config.world.chunkSize;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  private readonly snowLine: number;
  private readonly lakeLevel: number;
  /** Vertices of every LOD built (for stats). */
  builtTriangles = 0;

  constructor(
    private readonly terrain: Terrain,
    detail: Texture,
  ) {
    this.group.name = 'terrain';
    this.material = new MeshLambertMaterial({ vertexColors: true, map: detail });
    const road = terrain.road.bounds;
    const s = this.size;
    this.minX = Math.floor((road.minX - 640) / s) * s;
    this.maxX = Math.ceil((road.maxX + 640) / s) * s;
    this.minZ = Math.floor((road.minZ - 512) / s) * s;
    this.maxZ = Math.ceil((road.maxZ + 768) / s) * s;
    this.snowLine = terrain.mountain.def.snowLine;
    this.lakeLevel = terrain.mountain.def.lakeLevel;
    for (let z = this.minZ; z < this.maxZ; z += s) {
      for (let x = this.minX; x < this.maxX; x += s) {
        this.chunks.push({
          cx: x,
          cz: z,
          centerX: x + s / 2,
          centerZ: z + s / 2,
          lods: [null, null, null],
          current: -1,
        });
      }
    }
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  /** Builds the coarsest LOD everywhere (call during loading, reports progress 0..1). */
  *buildAll(): Generator<number> {
    let i = 0;
    for (const c of this.chunks) {
      this.ensure(c, 2);
      if (++i % 8 === 0) yield i / this.chunks.length;
    }
  }

  /** Builds the detailed LODs around a point (loading). */
  prebuildAround(x: number, z: number): void {
    for (const c of this.chunks) {
      const d = Math.hypot(c.centerX - x, c.centerZ - z);
      const want = this.lodFor(d, -1);
      this.ensure(c, want);
      this.show(c, want);
    }
  }

  private lodFor(d: number, current: number): number {
    const [l0, l1] = config.world.lodDistances;
    const hys = current >= 0 ? 12 : 0;
    if (d < l0 + (current === 0 ? hys : -hys * 0)) return 0;
    if (d < l1 + (current <= 1 ? hys : 0)) return 1;
    return 2;
  }

  /** Per-frame streaming: chooses LODs and builds missing meshes within a time budget. */
  update(
    camX: number,
    camZ: number,
    budgetMs: number = config.world.chunkBuildBudgetMs,
    viewDistance = 1e9,
  ): void {
    const start = performance.now();
    const pending: [Chunk, number, number][] = [];
    for (const c of this.chunks) {
      const d = Math.hypot(c.centerX - camX, c.centerZ - camZ);
      const visible = d < viewDistance + this.size;
      if (!visible) {
        this.show(c, -1);
        continue;
      }
      const want = this.lodFor(d, c.current);
      if (c.lods[want]) this.show(c, want);
      else {
        pending.push([c, want, d]);
        // Keep showing whatever exists meanwhile.
        if (c.current < 0) {
          const any = c.lods.findIndex((m) => m !== null);
          if (any >= 0) this.show(c, any);
        }
      }
      // Free detailed meshes far away.
      if (d > config.world.lodDistances[1] * 1.6 && c.lods[0]) this.free(c, 0);
    }
    pending.sort((a, b) => a[2] - b[2]);
    for (const [c, want] of pending) {
      if (performance.now() - start > budgetMs) break;
      this.ensure(c, want);
      this.show(c, want);
    }
  }

  private show(c: Chunk, lod: number): void {
    if (c.current === lod) return;
    c.lods.forEach((m, i) => {
      if (m) m.visible = i === lod;
    });
    c.current = lod;
  }

  private free(c: Chunk, lod: number): void {
    const m = c.lods[lod];
    if (!m) return;
    m.geometry.dispose();
    m.removeFromParent();
    c.lods[lod] = null;
    if (c.current === lod) c.current = -1;
  }

  private ensure(c: Chunk, lod: number): void {
    if (c.lods[lod]) return;
    const geo = this.buildGeometry(c.cx, c.cz, config.world.lodCellSizes[lod]);
    const mesh = new Mesh(geo, this.material);
    mesh.receiveShadow = lod < 2;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    c.lods[lod] = mesh;
  }

  private buildGeometry(x0: number, z0: number, cell: number): BufferGeometry {
    const t = this.terrain;
    const n = Math.round(this.size / cell);
    const stride = n + 1;
    const H = new Float32Array(stride * stride);
    const R = new Float32Array(stride * stride); // distance beyond road edge
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        H[j * stride + i] = t.height(x, z);
        const q = t.lastQuery;
        R[j * stride + i] = q.found ? q.distance - q.halfWidth : 99;
      }
    }
    const tris = n * n * 2 + n * 4 * 2;
    const pos = new Float32Array(tris * 9);
    const nor = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 9);
    const uv = new Float32Array(tris * 6);
    let k = 0;
    const uvScale = 1 / 9;
    const pushTri = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      cx: number,
      cy: number,
      cz: number,
      color: Color,
    ): void => {
      // Face normal.
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const p = k * 9;
      pos[p] = ax;
      pos[p + 1] = ay;
      pos[p + 2] = az;
      pos[p + 3] = bx;
      pos[p + 4] = by;
      pos[p + 5] = bz;
      pos[p + 6] = cx;
      pos[p + 7] = cy;
      pos[p + 8] = cz;
      for (let v = 0; v < 3; v++) {
        nor[p + v * 3] = nx;
        nor[p + v * 3 + 1] = ny;
        nor[p + v * 3 + 2] = nz;
        col[p + v * 3] = color.r;
        col[p + v * 3 + 1] = color.g;
        col[p + v * 3 + 2] = color.b;
      }
      const u = k * 6;
      uv[u] = ax * uvScale;
      uv[u + 1] = az * uvScale;
      uv[u + 2] = bx * uvScale;
      uv[u + 3] = bz * uvScale;
      uv[u + 4] = cx * uvScale;
      uv[u + 5] = cz * uvScale;
      k++;
    };
    const faceColor = (
      cx: number,
      cz: number,
      h: number,
      ny: number,
      road: number,
      out: Color,
    ): Color => this.colorFor(cx, cz, h, ny, road, out);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * cell;
        const za = z0 + j * cell;
        const xb = xa + cell;
        const zb = za + cell;
        const h00 = H[j * stride + i];
        const h10 = H[j * stride + i + 1];
        const h01 = H[(j + 1) * stride + i];
        const h11 = H[(j + 1) * stride + i + 1];
        const r00 = R[j * stride + i];
        const r10 = R[j * stride + i + 1];
        const r01 = R[(j + 1) * stride + i];
        const r11 = R[(j + 1) * stride + i + 1];
        // Alternate the diagonal for a less regular look.
        const flip = (i + j) % 2 === 0;
        if (flip) {
          // tri (00, 01, 10) and (10, 01, 11)  – counter-clockwise seen from above
          const hA = (h00 + h01 + h10) / 3;
          const nyA = faceNy(cell, h00, h10, h01, h00);
          pushTri(
            xa,
            h00,
            za,
            xa,
            h01,
            zb,
            xb,
            h10,
            za,
            faceColor(xa + cell / 3, za + cell / 3, hA, nyA, (r00 + r01 + r10) / 3, tmp),
          );
          const hB = (h10 + h01 + h11) / 3;
          const nyB = faceNy(cell, h01, h11, h10, h11);
          pushTri(
            xb,
            h10,
            za,
            xa,
            h01,
            zb,
            xb,
            h11,
            zb,
            faceColor(
              xa + (2 * cell) / 3,
              za + (2 * cell) / 3,
              hB,
              nyB,
              (r10 + r01 + r11) / 3,
              tmp,
            ),
          );
        } else {
          const hA = (h00 + h01 + h11) / 3;
          const nyA = faceNy(cell, h01, h11, h00, h01);
          pushTri(
            xa,
            h00,
            za,
            xa,
            h01,
            zb,
            xb,
            h11,
            zb,
            faceColor(xa + cell / 3, za + (2 * cell) / 3, hA, nyA, (r00 + r01 + r11) / 3, tmp),
          );
          const hB = (h00 + h11 + h10) / 3;
          const nyB = faceNy(cell, h00, h10, h10, h11);
          pushTri(
            xa,
            h00,
            za,
            xb,
            h11,
            zb,
            xb,
            h10,
            za,
            faceColor(xa + (2 * cell) / 3, za + cell / 3, hB, nyB, (r00 + r11 + r10) / 3, tmp),
          );
        }
      }
    }
    // Skirts hide cracks between neighbouring chunks of different LOD.
    const depth = config.world.skirtDepth;
    const skirt = (
      ax: number,
      az: number,
      ha: number,
      bx: number,
      bz: number,
      hb: number,
    ): void => {
      tmp2.copy(this.colorFor(ax, az, ha, 0.5, 99, tmp2)).multiplyScalar(0.8);
      pushTri(ax, ha, az, bx, hb, bz, ax, ha - depth, az, tmp2);
      pushTri(bx, hb, bz, bx, hb - depth, bz, ax, ha - depth, az, tmp2);
    };
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * cell;
      const xb = xa + cell;
      // Wound so each skirt faces outwards.
      skirt(xa, z0, H[i], xb, z0, H[i + 1]);
      skirt(xb, z0 + this.size, H[n * stride + i + 1], xa, z0 + this.size, H[n * stride + i]);
      const za = z0 + i * cell;
      const zb = za + cell;
      skirt(x0, zb, H[(i + 1) * stride], x0, za, H[i * stride]);
      skirt(x0 + this.size, za, H[i * stride + n], x0 + this.size, zb, H[(i + 1) * stride + n]);
    }
    this.builtTriangles += k;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos.subarray(0, k * 9), 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor.subarray(0, k * 9), 3));
    geo.setAttribute('color', new Float32BufferAttribute(col.subarray(0, k * 9), 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv.subarray(0, k * 6), 2));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  /** Terrain colour from altitude, slope, road proximity and per-face jitter. */
  colorFor(x: number, z: number, h: number, ny: number, roadDist: number, out: Color): Color {
    const wobble = Math.sin(x * 0.05) * 8 + Math.cos(z * 0.043) * 8;
    const jitter = 0.94 + hash2(Math.floor(x * 0.7), Math.floor(z * 0.7), 3) * 0.12;
    const alt = clamp((h - this.lakeLevel) / Math.max(1, this.snowLine - this.lakeLevel), 0, 1.4);
    // Vegetation gradient: forest floor at the bottom, meadow higher up.
    out
      .copy(PALETTE.forest)
      .lerp(PALETTE.grass, smoothstep(0.15, 0.55, alt))
      .lerp(PALETTE.alpine, smoothstep(0.6, 0.95, alt));
    const sand = 1 - smoothstep(this.lakeLevel + 1, this.lakeLevel + 4, h);
    if (sand > 0) out.lerp(PALETTE.sand, sand);
    if (h < this.lakeLevel - 0.8) out.copy(PALETTE.lakebed);
    const rock = 1 - smoothstep(0.72, 0.84, ny);
    if (rock > 0) {
      tmp2
        .copy(PALETTE.rock)
        .lerp(PALETTE.rockDark, hash2(Math.floor(x * 0.3), Math.floor(z * 0.3), 9));
      out.lerp(tmp2, rock);
    }
    const snow =
      smoothstep(this.snowLine - 12, this.snowLine + 14, h + wobble) * smoothstep(0.62, 0.78, ny);
    if (snow > 0) out.lerp(ny > 0.9 ? PALETTE.snow : PALETTE.snowShade, snow);
    const dirt = 1 - smoothstep(0.5, 3.2, roadDist);
    if (dirt > 0) out.lerp(snow > 0.5 ? PALETTE.snowShade : PALETTE.dirt, dirt * 0.85);
    return out.multiplyScalar(jitter * lerp(1, 0.9, rock));
  }

  dispose(): void {
    for (const c of this.chunks) for (let i = 0; i < 3; i++) this.free(c, i);
    this.material.dispose();
    this.group.removeFromParent();
  }
}

/** Approximate face normal Y from the two edge height differences of a grid cell. */
function faceNy(cell: number, a: number, b: number, c: number, d: number): number {
  const dx = (b - a) / cell;
  const dz = (c - d) / cell;
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}
