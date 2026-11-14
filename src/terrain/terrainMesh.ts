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
import type { Terrain } from './terrain';
import { PatchBuild, UNITS_PER_CELL, type PatchArrays, type PatchRequest } from './patchBuilder';
import type { PatchBackend } from './terrainService';
import type { PatchPalette } from './splat';

interface QuadNode {
  key: number;
  level: number;
  x0: number;
  z0: number;
  size: number;
  mesh: Mesh | null;
  arrays: PatchArrays | null;
  requested: boolean;
  lastShown: number;
  tris: number;
}

export interface TerrainMeshOptions {
  /** LOD0 face size (m): ~1 high, ~1.5 medium, ~2.5 low. */
  lod0Cell: number;
  /** Radius (m) of the LOD0 ring around the camera. */
  lod0Radius: number;
  /** Triangles drawn at most; the LOD rings shrink to respect it. */
  triangleBudget: number;
  /** Largest number of cells per patch side (smaller patches waste fewer triangles). */
  maxPatchCells?: number;
}

/**
 * Picks the quadtree depth and cells per patch so that the finest patches have faces of
 * `lod0Cell` metres and the root covers at least `minRoot` metres.
 */
export function lodLayout(
  lod0Cell: number,
  minRoot: number,
  maxN = 96,
): { depth: number; n: number; root: number } {
  for (let depth = 4; depth <= 10; depth++) {
    const n = Math.ceil(minRoot / (lod0Cell * (1 << depth)));
    if (n <= maxN)
      return { depth, n: Math.max(16, n), root: Math.max(16, n) * lod0Cell * (1 << depth) };
  }
  return { depth: 10, n: 96, root: 96 * lod0Cell * 1024 };
}

/**
 * Quadtree terrain. Each node is a square patch of N × N cells; nodes split while their cell
 * size exceeds the target for their distance (LOD0 `lod0Cell` within `lod0Radius`, then about
 * 2.5 m to 600 m, 6 m to 1.5 km, 16 m to 3.5 km and ~48 m beyond). Patches are flat-shaded, built in the
 * terrain worker (or the main thread in time slices), use compact attributes (Int16
 * positions, Uint8 colours, Int8 normals), have skirts against LOD cracks, recycle their
 * buffers when evicted, and the rings shrink when the triangle budget is exceeded.
 */
export class TerrainMesh {
  readonly group = new Group();
  readonly material: MeshLambertMaterial;
  private readonly nodes = new Map<number, QuadNode>();
  private readonly rootSize: number;
  private readonly rootMin: number;
  private readonly maxDepth: number;
  readonly n: number;
  private readonly shown = new Set<QuadNode>();
  private readonly desired: QuadNode[] = [];
  private time = 0;
  /**
   * Ring scales under the triangle budget: the far rings (≥ 6 m faces) shrink first, the
   * near ones (LOD0 and LOD1) only when the far ones are at their minimum.
   */
  farScale = 1;
  nearScale = 1;
  /** Scale of the LOD0 ring (1 = nominal). */
  get lodScale(): number {
    return this.nearScale;
  }
  visibleTriangles = 0;
  builtTriangles = 0;
  private readonly rings: [number, number][];

  constructor(
    private readonly terrain: Terrain,
    private readonly palette: PatchPalette,
    private readonly opts: TerrainMeshOptions,
    private readonly backend: PatchBackend,
  ) {
    this.group.name = 'terrain';
    this.material = new MeshLambertMaterial({ vertexColors: true });
    const layout = lodLayout(
      opts.lod0Cell,
      terrain.mountain.def.halfSize * 2.5,
      opts.maxPatchCells,
    );
    this.rootSize = layout.root;
    this.rootMin = -layout.root / 2;
    this.maxDepth = layout.depth;
    this.n = layout.n;
    const l = config.world.lod;
    this.rings = [
      [opts.lod0Radius, opts.lod0Cell],
      [l.lod1Radius, Math.max(opts.lod0Cell * 2, l.lod1Cell)],
      [l.lod2Radius, l.lod2Cell],
      [l.lod3Radius, l.lod3Cell],
      [Infinity, l.lod4Cell],
    ];
  }

  /** Finest face size (m) wanted at a distance. */
  targetCell(d: number): number {
    const rings = this.rings;
    for (let i = 0; i < rings.length; i++)
      if (d < rings[i][0] * (i < 2 ? this.nearScale : this.farScale * this.nearScale))
        return rings[i][1];
    return rings[rings.length - 1][1];
  }

  /** Face size (m) of the finest level. */
  get finestCell(): number {
    return this.rootSize / (1 << this.maxDepth) / this.n;
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
        arrays: null,
        requested: false,
        lastShown: 0,
        tris: 0,
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
    const cell = nd.size / this.n;
    if (
      nd.level < this.maxDepth &&
      cell > this.targetCell(this.distance(nd, cx, cz, above)) * config.world.lodTolerance
    ) {
      for (const c of this.children(nd)) this.collect(c, cx, cz, above);
    } else this.desired.push(nd);
  }

  private request(nd: QuadNode): Omit<PatchRequest, 'gen'> {
    return { key: nd.key, x0: nd.x0, z0: nd.z0, size: nd.size, n: this.n };
  }

  /**
   * Builds everything needed around a point. Synchronous on the main thread; yields progress
   * (0..1) after each patch.
   */
  *prebuild(x: number, y: number, z: number): Generator<number> {
    const root = this.node(0, 0, 0);
    this.ensureNow(root);
    this.desired.length = 0;
    this.collect(root, x, z, Math.max(0, y - this.terrain.height(x, z)));
    const list = [...this.desired];
    let k = 0;
    for (const nd of list) {
      this.ensureNow(nd);
      yield ++k / list.length;
    }
    this.update(x, y, z);
  }

  /**
   * Requests every patch needed around a point from the backend (the worker) and yields its
   * progress until all have arrived: the loading screen stays responsive.
   */
  *prebuildAsync(x: number, y: number, z: number): Generator<number> {
    const root = this.node(0, 0, 0);
    this.ensureNow(root);
    this.desired.length = 0;
    this.collect(root, x, z, Math.max(0, y - this.terrain.height(x, z)));
    const list = [...this.desired];
    for (const nd of list) this.ask(nd);
    for (;;) {
      this.backend.pump(12);
      const ready = list.filter((nd) => nd.mesh).length;
      yield ready / list.length;
      if (ready === list.length) break;
    }
    this.update(x, y, z);
  }

  private ask(nd: QuadNode): void {
    if (nd.mesh || nd.requested) return;
    nd.requested = true;
    this.backend.request(this.request(nd), (r) => {
      nd.requested = false;
      if (nd.mesh || !this.nodes.has(nd.key)) {
        this.backend.recycle(r);
        return;
      }
      this.attach(nd, r);
    });
  }

  private ensureNow(nd: QuadNode): void {
    if (nd.mesh) return;
    const b = new PatchBuild(this.terrain, this.palette, { ...this.request(nd), gen: 0 });
    b.step(Infinity);
    this.attach(nd, b.result!);
  }

  /** Per frame: chooses the patches to show and asks for missing ones, closest first. */
  update(
    cx: number,
    cy: number,
    cz: number,
    budgetMs: number = config.world.chunkBuildBudgetMs,
  ): void {
    this.time += 1;
    const root = this.node(0, 0, 0);
    if (!root.mesh) this.ensureNow(root);
    this.desired.length = 0;
    this.collect(root, cx, cz, Math.max(0, cy - this.terrain.height(cx, cz)));
    const shown = this.shown;
    shown.clear();
    const missing: QuadNode[] = [];
    for (const leaf of this.desired) {
      if (leaf.mesh) {
        shown.add(leaf);
        continue;
      }
      missing.push(leaf);
      // Finer patches already built cover the leaf completely?
      const kids = leaf.level < this.maxDepth ? this.children(leaf) : [];
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
    let tris = 0;
    for (const nd of this.nodes.values()) {
      if (!nd.mesh) continue;
      const vis = shown.has(nd);
      nd.mesh.visible = vis;
      if (vis) {
        nd.lastShown = this.time;
        tris += nd.tris;
      }
    }
    this.visibleTriangles = tris;
    // Triangle budget: shrink the rings when over, relax them back when well under.
    const budget = this.opts.triangleBudget;
    if (tris > budget) {
      if (this.farScale > 0.4) this.farScale = Math.max(0.4, this.farScale * 0.98);
      else this.nearScale = Math.max(0.45, this.nearScale * 0.98);
    } else if (tris < budget * 0.8) {
      if (this.nearScale < 1) this.nearScale = Math.min(1, this.nearScale * 1.005);
      else this.farScale = Math.min(1, this.farScale * 1.005);
    }
    // Ask for the closest missing patches (a few in flight at a time).
    missing.sort(
      (a, b) =>
        this.distance(a, cx, cz, 0) + a.size * 0.2 - (this.distance(b, cx, cz, 0) + b.size * 0.2),
    );
    for (const nd of missing) {
      if (this.backend.pending >= 6) break;
      this.ask(nd);
    }
    this.backend.pump(budgetMs);
    this.evict();
  }

  private evict(): void {
    if (this.nodes.size < 400) return;
    for (const nd of this.nodes.values()) {
      if (nd.level === 0 || this.shown.has(nd) || nd.requested) continue;
      if (nd.mesh && this.time - nd.lastShown > 600) this.free(nd);
      if (!nd.mesh) this.nodes.delete(nd.key);
    }
  }

  private attach(nd: QuadNode, r: PatchArrays): void {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(r.position, 3));
    geo.setAttribute('color', new BufferAttribute(r.color, 3, true));
    geo.setAttribute('normal', new BufferAttribute(r.normal, 3, true));
    geo.setDrawRange(0, r.count);
    const inv = 1 / r.unit;
    const half = (this.n * UNITS_PER_CELL) / 2;
    const c = new Vector3(half, ((r.minY + r.maxY) / 2 - r.originY) * inv, half);
    geo.boundingSphere = new Sphere(c, Math.hypot(half, half, ((r.maxY - r.minY) / 2) * inv));
    const mesh = new Mesh(geo, this.material);
    mesh.position.set(nd.x0, r.originY, nd.z0);
    mesh.scale.setScalar(r.unit);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = nd.size < 400;
    mesh.visible = false;
    nd.mesh = mesh;
    nd.arrays = r;
    nd.tris = r.count / 3;
    this.builtTriangles += nd.tris;
    this.group.add(mesh);
  }

  private free(nd: QuadNode): void {
    if (!nd.mesh) return;
    nd.mesh.geometry.dispose();
    nd.mesh.removeFromParent();
    nd.mesh = null;
    if (nd.arrays) this.backend.recycle(nd.arrays);
    nd.arrays = null;
  }

  /** Number of patches currently drawn (stats). */
  get visibleCount(): number {
    return this.shown.size;
  }

  dispose(): void {
    this.backend.cancelAll();
    for (const nd of this.nodes.values()) {
      if (!nd.mesh) continue;
      nd.mesh.geometry.dispose();
      nd.mesh.removeFromParent();
      nd.mesh = null;
    }
    this.nodes.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
