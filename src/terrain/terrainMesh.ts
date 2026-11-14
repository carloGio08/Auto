import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Sphere,
  Vector3,
} from 'three';
import { config } from '../config';
import { hash2 } from '../math/rng';
import type { ResolvedPalette } from '../data/palette';
import type { Terrain } from './terrain';

interface QuadNode {
  key: number;
  level: number;
  x0: number;
  z0: number;
  size: number;
  mesh: Mesh | null;
  lastShown: number;
}

/** Incremental patch builder state (time-sliced across frames). */
interface Build {
  node: QuadNode;
  n: number;
  row: number;
  H: Float32Array;
  R: Float32Array;
  W: Float32Array;
}

const MAX_DEPTH = 6;

/**
 * Quadtree terrain: square patches of N×N cells whose size halves near the camera (≈2.4–5 m
 * cells at the finest level depending on quality). Patches are flat-shaded with per-face
 * palette colours (two tones chosen by hash) and face normals (Int8), have skirts to hide LOD cracks, are built
 * incrementally within a per-frame time budget and evicted when unused.
 */
export class TerrainMesh {
  readonly group = new Group();
  readonly material: MeshLambertMaterial;
  private readonly nodes = new Map<number, QuadNode>();
  private readonly rootSize: number;
  private readonly rootMin: number;
  private n: number;
  private build: Build | null = null;
  private readonly queue: QuadNode[] = [];
  private readonly shown = new Set<QuadNode>();
  private readonly desired: QuadNode[] = [];
  private time = 0;
  private readonly lakeLevel: number;
  builtTriangles = 0;

  constructor(
    private readonly terrain: Terrain,
    private readonly palette: ResolvedPalette,
    cellsPerPatch: number,
  ) {
    this.group.name = 'terrain';
    this.material = new MeshLambertMaterial({ vertexColors: true });
    const half = terrain.mountain.def.halfSize;
    this.rootSize = half * 2.5;
    this.rootMin = -this.rootSize / 2;
    this.n = cellsPerPatch;
    this.lakeLevel = terrain.mountain.def.lake.level;
  }

  private node(level: number, i: number, j: number): QuadNode {
    const key = level * 1e8 + i * 1e4 + j;
    let nd = this.nodes.get(key);
    if (!nd) {
      const size = this.rootSize / (1 << level);
      nd = {
        key,
        level,
        x0: this.rootMin + i * size,
        z0: this.rootMin + j * size,
        size,
        mesh: null,
        lastShown: 0,
      };
      this.nodes.set(key, nd);
    }
    return nd;
  }

  private children(nd: QuadNode): QuadNode[] {
    const i = Math.round((nd.x0 - this.rootMin) / nd.size) * 2;
    const j = Math.round((nd.z0 - this.rootMin) / nd.size) * 2;
    const l = nd.level + 1;
    return [
      this.node(l, i, j),
      this.node(l, i + 1, j),
      this.node(l, i, j + 1),
      this.node(l, i + 1, j + 1),
    ];
  }

  private parent(nd: QuadNode): QuadNode | null {
    if (nd.level === 0) return null;
    const size = nd.size * 2;
    return this.node(
      nd.level - 1,
      Math.floor((nd.x0 - this.rootMin + 1e-3) / size),
      Math.floor((nd.z0 - this.rootMin + 1e-3) / size),
    );
  }

  /** Distance from the camera to the closest point of a node (horizontal + height above ground). */
  private distance(nd: QuadNode, cx: number, cz: number, above: number): number {
    const dx = Math.max(nd.x0 - cx, 0, cx - (nd.x0 + nd.size));
    const dz = Math.max(nd.z0 - cz, 0, cz - (nd.z0 + nd.size));
    return Math.hypot(dx, dz, above * 0.5);
  }

  private collect(nd: QuadNode, cx: number, cz: number, above: number): void {
    if (
      nd.level < MAX_DEPTH &&
      this.distance(nd, cx, cz, above) < nd.size * config.world.lodSplit
    ) {
      for (const c of this.children(nd)) this.collect(c, cx, cz, above);
    } else this.desired.push(nd);
  }

  /** Builds everything needed around a point synchronously (loading). */
  *prebuild(x: number, y: number, z: number): Generator<number> {
    this.ensureNow(this.node(0, 0, 0));
    this.desired.length = 0;
    this.collect(this.node(0, 0, 0), x, z, Math.max(0, y - this.terrain.height(x, z)));
    let k = 0;
    for (const nd of this.desired) {
      this.ensureNow(nd);
      yield ++k / this.desired.length;
    }
    this.update(x, y, z, 0);
  }

  private ensureNow(nd: QuadNode): void {
    if (nd.mesh) return;
    const b = this.startBuild(nd);
    while (!this.step(b, Infinity)) {
      /* build fully */
    }
  }

  /** Per frame: chooses the patches to show and advances the build queue. */
  update(
    cx: number,
    cy: number,
    cz: number,
    budgetMs: number = config.world.chunkBuildBudgetMs,
  ): void {
    this.time += 1;
    const root = this.node(0, 0, 0);
    this.desired.length = 0;
    this.collect(root, cx, cz, Math.max(0, cy - this.terrain.height(cx, cz)));
    const shown = this.shown;
    shown.clear();
    this.queue.length = 0;
    for (const leaf of this.desired) {
      if (leaf.mesh) {
        shown.add(leaf);
        continue;
      }
      this.queue.push(leaf);
      // Finer patches already built cover the leaf completely?
      const kids = leaf.level < MAX_DEPTH ? this.children(leaf) : [];
      if (kids.length && kids.every((k) => k.mesh)) {
        kids.forEach((k) => shown.add(k));
        continue;
      }
      // Otherwise the closest built ancestor stands in.
      let a = this.parent(leaf);
      while (a && !a.mesh) a = this.parent(a);
      if (a) shown.add(a);
    }
    // Remove anything covered by a shown ancestor (avoid overlapping LODs).
    for (const nd of [...shown]) {
      let a = this.parent(nd);
      while (a) {
        if (shown.has(a)) {
          shown.delete(nd);
          break;
        }
        a = this.parent(a);
      }
    }
    for (const nd of this.nodes.values()) {
      if (!nd.mesh) continue;
      const vis = shown.has(nd);
      nd.mesh.visible = vis;
      if (vis) nd.lastShown = this.time;
    }
    // Build queue: closest first.
    if (budgetMs > 0) {
      const start = performance.now();
      while (performance.now() - start < budgetMs) {
        if (!this.build) {
          let best: QuadNode | null = null;
          let bd = Infinity;
          for (const nd of this.queue) {
            if (nd.mesh) continue;
            const d = this.distance(nd, cx, cz, 0) + nd.size * 0.2;
            if (d < bd) {
              bd = d;
              best = nd;
            }
          }
          if (!best) break;
          this.build = this.startBuild(best);
        }
        if (this.step(this.build, start + budgetMs)) this.build = null;
      }
    }
    this.evict();
  }

  private evict(): void {
    if (this.nodes.size < 320) return;
    for (const nd of this.nodes.values()) {
      if (nd.level === 0 || this.shown.has(nd)) continue;
      if (nd.mesh && this.time - nd.lastShown > 600) this.free(nd);
      if (!nd.mesh && this.build?.node !== nd) this.nodes.delete(nd.key);
    }
  }

  private startBuild(node: QuadNode): Build {
    const n = this.n;
    const s = (n + 1) * (n + 1);
    return {
      node,
      n,
      row: 0,
      H: new Float32Array(s),
      R: new Float32Array(s),
      W: new Float32Array(s),
    };
  }

  /** Samples heights row by row; returns true when the patch mesh has been created. */
  private step(b: Build, deadline: number): boolean {
    const { node, n } = b;
    const cell = node.size / n;
    const stride = n + 1;
    const t = this.terrain;
    while (b.row <= n) {
      const z = node.z0 + b.row * cell;
      for (let i = 0; i <= n; i++) {
        const k = b.row * stride + i;
        b.H[k] = t.height(node.x0 + i * cell, z);
        const q = t.lastQuery;
        b.R[k] = q.found ? q.distance : 1e4;
        b.W[k] = q.found ? q.halfWidth : 0;
      }
      b.row++;
      if (performance.now() > deadline) return false;
    }
    node.mesh = this.createMesh(b);
    node.mesh.visible = false;
    this.group.add(node.mesh);
    return true;
  }

  private createMesh(b: Build): Mesh {
    const { node, n, H, R, W } = b;
    const cell = node.size / n;
    const stride = n + 1;
    const x0 = node.x0;
    const z0 = node.z0;
    const tris = n * n * 2 + n * 8;
    const pos = new Float32Array(tris * 9);
    const col = new Uint8Array(tris * 9);
    const nor = new Int8Array(tris * 9);
    let k = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    const terrain = this.terrain;
    const pal = this.palette;
    const lake = this.lakeLevel;
    const tri = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      cx: number,
      cy: number,
      cz: number,
      rd: number,
      hw: number,
      skirt: boolean,
    ): void => {
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const ln = Math.hypot(nx, ny, nz) || 1;
      const fx = (ax + bx + cx) / 3;
      const fy = (ay + by + cy) / 3;
      const fz = (az + bz + cz) / 3;
      const nyn = skirt ? 0.9 : ny / ln;
      const biome = fy < lake - 0.5 ? 'sand' : terrain.classify(fx, fz, fy, nyn, rd, hw).key;
      // Two tones per biome: hash choice, steep faces lean towards the dark tone.
      const hsh = hash2(Math.floor(fx * 0.37), Math.floor(fz * 0.37), 11);
      const tone = hsh < (nyn < 0.86 ? 0.7 : 0.35) ? 1 : 0;
      const c = pal[biome][tone];
      const r = Math.round(Math.min(1, c.r) * 255);
      const g = Math.round(Math.min(1, c.g) * 255);
      const bl = Math.round(Math.min(1, c.b) * 255);
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
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * cell;
        const za = z0 + j * cell;
        const xb = xa + cell;
        const zb = za + cell;
        const i00 = j * stride + i;
        const i10 = i00 + 1;
        const i01 = i00 + stride;
        const i11 = i01 + 1;
        const h00 = H[i00];
        const h10 = H[i10];
        const h01 = H[i01];
        const h11 = H[i11];
        minY = Math.min(minY, h00, h10, h01, h11);
        maxY = Math.max(maxY, h00, h10, h01, h11);
        const rd = (R[i00] + R[i10] + R[i01] + R[i11]) * 0.25;
        const hw = Math.max(W[i00], W[i10], W[i01], W[i11]);
        if ((i + j) % 2 === 0) {
          tri(xa, h00, za, xa, h01, zb, xb, h10, za, rd, hw, false);
          tri(xb, h10, za, xa, h01, zb, xb, h11, zb, rd, hw, false);
        } else {
          tri(xa, h00, za, xa, h01, zb, xb, h11, zb, rd, hw, false);
          tri(xa, h00, za, xb, h11, zb, xb, h10, za, rd, hw, false);
        }
      }
    }
    // Skirts (outward facing) hide cracks between patches of different size.
    const depth = cell * 1.5 + 2;
    const skirt = (
      ax: number,
      az: number,
      ha: number,
      bx: number,
      bz: number,
      hb: number,
    ): void => {
      tri(ax, ha, az, bx, hb, bz, ax, ha - depth, az, 1e4, 0, true);
      tri(bx, hb, bz, bx, hb - depth, bz, ax, ha - depth, az, 1e4, 0, true);
    };
    const size = node.size;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * cell;
      const xb = xa + cell;
      skirt(xa, z0, H[i], xb, z0, H[i + 1]);
      skirt(xb, z0 + size, H[n * stride + i + 1], xa, z0 + size, H[n * stride + i]);
      const za = z0 + i * cell;
      const zb = za + cell;
      skirt(x0, zb, H[(i + 1) * stride], x0, za, H[i * stride]);
      skirt(x0 + size, za, H[i * stride + n], x0 + size, zb, H[(i + 1) * stride + n]);
    }
    this.builtTriangles += k;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos.subarray(0, k * 9), 3));
    geo.setAttribute('color', new BufferAttribute(col.subarray(0, k * 9), 3, true));
    geo.setAttribute('normal', new BufferAttribute(nor.subarray(0, k * 9), 3, true));
    const c = new Vector3(x0 + size / 2, (minY + maxY) / 2, z0 + size / 2);
    geo.boundingSphere = new Sphere(c, Math.hypot(size / 2, size / 2, (maxY - minY) / 2 + depth));
    const mesh = new Mesh(geo, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = size < 400;
    return mesh;
  }

  private free(nd: QuadNode): void {
    if (!nd.mesh) return;
    nd.mesh.geometry.dispose();
    nd.mesh.removeFromParent();
    nd.mesh = null;
  }

  /** Number of patches currently drawn (stats). */
  get visibleCount(): number {
    return this.shown.size;
  }

  dispose(): void {
    for (const nd of this.nodes.values()) this.free(nd);
    this.nodes.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
