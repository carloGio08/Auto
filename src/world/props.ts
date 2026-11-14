import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { config, type QualityPreset } from '../config';
import type { ResolvedPalette } from '../data/palette';
import type { Course } from '../terrain/course';
import type { Collider, CollisionWorld } from './colliders';
import { PropGeometry, type TreeTier } from './propGeometry';
import { placeCell, PROP_TYPES, type PropInstance, type PropType } from './propPlacement';

/** Tree record of a loaded cell (also the collider owner). */
export interface TreeRef {
  cell: PropCell;
  index: number;
  tier: TreeTier;
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Stable id: survives cell unload/reload so broken trees stay broken. */
  id: number;
}

type Instance = PropInstance;

export interface PropCell {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  near: InstancedMesh[];
  far: InstancedMesh | null;
  trees: TreeRef[];
  /** Mesh + instance slot of each tree (for hiding/shrinking). */
  treeSlots: { mesh: InstancedMesh; slot: number }[];
  colliders: Collider[];
  detailed: boolean;
}

const TYPES = PROP_TYPES;
const TREE_TIER: Partial<Record<PropType, TreeTier>> = {
  pineYoung0: 'young',
  pineYoung1: 'young',
  pineMid0: 'medium',
  pineMid1: 'medium',
  roundMid: 'medium',
  pineOld0: 'old',
  pineOld1: 'old',
  pineSnow: 'old',
};
/** Trunk radius per tier at scale 1 (collision). */
const TRUNK: Record<TreeTier, number> = { young: 0.18, medium: 0.32, old: 0.5 };

const m = new Matrix4();
const q = new Quaternion();
const sv = new Vector3();
const pv = new Vector3();
const yAxis = new Vector3(0, 1, 0);

/**
 * Vegetation and rocks, generated deterministically per cell around the camera and rendered
 * as one InstancedMesh per prop type per cell. Far cells show trees as single cones.
 * Colliders live and die with their cell; broken trees are remembered by id.
 */
export class Props {
  readonly group = new Group();
  private readonly geos: BufferGeometry[];
  private readonly farGeo: BufferGeometry;
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly cells = new Map<number, PropCell>();
  /** Ids of trees broken during this run (become stumps). */
  readonly broken = new Set<number>();
  private readonly size = config.world.propCellSize;
  instanceCount = 0;
  private shadows: boolean;

  constructor(
    private readonly course: Course,
    private readonly colliders: CollisionWorld,
    private preset: QualityPreset,
    palette: ResolvedPalette,
  ) {
    this.group.name = 'props';
    const g = new PropGeometry(palette);
    const builders: Record<PropType, () => BufferGeometry> = {
      pineYoung0: () => g.pine('young', 0),
      pineYoung1: () => g.pine('young', 1),
      pineMid0: () => g.pine('medium', 0),
      pineMid1: () => g.pine('medium', 1),
      roundMid: () => g.roundTree(0),
      pineOld0: () => g.pine('old', 0),
      pineOld1: () => g.pine('old', 1),
      pineSnow: () => g.pine('old', 2, true),
      bush0: () => g.bush(0),
      bush1: () => g.bush(1),
      rock0: () => g.rock(0),
      rock1: () => g.rock(1),
      rock2: () => g.rock(2),
      rockSlab: () => g.rockSlab(),
      rockSpire: () => g.rockSpire(),
      rockRound: () => g.rockRound(),
      stump: () => g.stump(),
    };
    this.geos = TYPES.map((t) => builders[t]());
    this.farGeo = g.farTree();
    this.shadows = preset.shadows;
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /** Generates the instances (and rock colliders) of one cell. */
  private generate(cx: number, cz: number): Instance[] {
    const placed = placeCell(this.course, cx, cz, this.size, this.preset.propDensity);
    for (const [x, z, r, y0, y1] of placed.rockColliders)
      this.pendingColliders.push(['rock', x, z, r, y0, y1, null]);
    return placed.instances;
  }

  /** Colliders found while generating (rocks); trees are added with their refs. */
  private pendingColliders: [Collider['kind'], number, number, number, number, number, unknown][] =
    [];

  private loadCell(cx: number, cz: number): PropCell {
    this.pendingColliders = [];
    const inst = this.generate(cx, cz);
    const cell: PropCell = {
      cx,
      cz,
      centerX: (cx + 0.5) * this.size,
      centerZ: (cz + 0.5) * this.size,
      near: [],
      far: null,
      trees: [],
      treeSlots: [],
      colliders: [],
      detailed: true,
    };
    const byType = TYPES.map(() => [] as Instance[]);
    for (const i of inst) byType[i.type].push(i);
    const stumpIdx = TYPES.indexOf('stump');
    const treeInstances: Instance[] = [];
    byType.forEach((list, t) => {
      if (!list.length && t !== stumpIdx) return;
      const tier = TREE_TIER[TYPES[t]];
      // Stumps: reserve slots for every tree of the cell so breaking never allocates.
      const capacity =
        t === stumpIdx
          ? Math.max(1, inst.filter((i) => TREE_TIER[TYPES[i.type]]).length)
          : list.length;
      const mesh = new InstancedMesh(this.geos[t], this.material, capacity);
      mesh.count = t === stumpIdx ? 0 : list.length;
      list.forEach((it, k) => {
        q.setFromAxisAngle(yAxis, it.rot);
        sv.setScalar(it.scale);
        if (TYPES[t].startsWith('rock')) sv.set(it.scale * 1.1, it.scale * 0.9, it.scale);
        m.compose(pv.set(it.x, it.y, it.z), q, sv);
        mesh.setMatrixAt(k, m);
        if (tier) {
          const id = this.key(cx, cz) * 8192 + cell.trees.length;
          const ref: TreeRef = {
            cell,
            index: cell.trees.length,
            tier,
            x: it.x,
            y: it.y,
            z: it.z,
            scale: it.scale,
            id,
          };
          cell.trees.push(ref);
          cell.treeSlots.push({ mesh, slot: k });
          treeInstances.push(it);
          const c = this.colliders.addCircle(
            'tree',
            it.x,
            it.z,
            TRUNK[tier] * it.scale,
            it.y - 1,
            it.y + 8 * it.scale,
          );
          c.owner = ref;
          cell.colliders.push(c);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows && !!tier;
      mesh.userData.castShadow = !!tier || TYPES[t].startsWith('rock');
      mesh.userData.stump = t === stumpIdx;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = true;
      cell.near.push(mesh);
      this.group.add(mesh);
    });
    for (const [kind, x, z, r, y0, y1, owner] of this.pendingColliders) {
      const c = this.colliders.addCircle(kind, x, z, r, y0, y1);
      c.owner = owner;
      cell.colliders.push(c);
    }
    // Far representation: every tree as one cone (one draw call per cell).
    if (treeInstances.length) {
      const far = new InstancedMesh(this.farGeo, this.material, treeInstances.length);
      treeInstances.forEach((it, k) => {
        m.compose(
          pv.set(it.x, it.y, it.z),
          q.setFromAxisAngle(yAxis, it.rot),
          sv.setScalar(
            it.scale *
              (TREE_TIER[TYPES[it.type]] === 'young'
                ? 0.45
                : TREE_TIER[TYPES[it.type]] === 'medium'
                  ? 0.8
                  : 1.2),
          ),
        );
        far.setMatrixAt(k, m);
      });
      far.instanceMatrix.needsUpdate = true;
      far.computeBoundingSphere();
      far.matrixAutoUpdate = false;
      far.visible = false;
      cell.far = far;
      this.group.add(far);
    }
    this.instanceCount += inst.length;
    // Re-apply trees broken earlier in this run.
    for (const t of cell.trees) if (this.broken.has(t.id)) this.applyBroken(t);
    return cell;
  }

  private unloadCell(cell: PropCell): void {
    for (const mesh of cell.near) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    if (cell.far) {
      cell.far.removeFromParent();
      cell.far.dispose();
    }
    for (const c of cell.colliders) this.colliders.remove(c);
    this.instanceCount -= cell.trees.length;
    this.cells.delete(this.key(cell.cx, cell.cz));
  }

  /** Hides a tree instance and shows a stump in its place; disables its collider. */
  private applyBroken(t: TreeRef): void {
    const slot = t.cell.treeSlots[t.index];
    m.makeScale(0, 0, 0);
    slot.mesh.setMatrixAt(slot.slot, m);
    slot.mesh.instanceMatrix.needsUpdate = true;
    if (t.cell.far) {
      t.cell.far.setMatrixAt(t.index, m);
      t.cell.far.instanceMatrix.needsUpdate = true;
    }
    const stumps = t.cell.near.find((n) => n.userData.stump);
    if (stumps && stumps.count < stumps.instanceMatrix.count) {
      m.compose(
        pv.set(t.x, t.y, t.z),
        q.identity(),
        sv.setScalar(t.scale * (t.tier === 'young' ? 0.6 : t.tier === 'medium' ? 0.9 : 1.2)),
      );
      stumps.setMatrixAt(stumps.count++, m);
      stumps.instanceMatrix.needsUpdate = true;
    }
    for (const c of t.cell.colliders) if (c.owner === t) c.enabled = false;
  }

  /** Breaks a tree: becomes a stump, collider disabled, remembered by id. */
  breakTree(t: TreeRef): void {
    if (this.broken.has(t.id)) return;
    this.broken.add(t.id);
    this.applyBroken(t);
  }

  /** Restores every tree (run restart). */
  restoreTrees(): void {
    this.broken.clear();
    for (const cell of [...this.cells.values()]) this.unloadCell(cell);
  }

  /** Loads all cells around a point at once (loading screen). */
  prebuild(x: number, z: number): void {
    this.update(x, z, Infinity);
  }

  /** Streams cells in/out around the camera and switches near/far tree meshes. */
  update(camX: number, camZ: number, maxNewCells = 1): void {
    const s = this.size;
    const r = this.preset.propDistance;
    const ccx = Math.floor(camX / s);
    const ccz = Math.floor(camZ / s);
    const span = Math.ceil(r / s) + 1;
    let created = 0;
    // Load closest missing cells first.
    const wanted: [number, number, number][] = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const d = Math.hypot((cx + 0.5) * s - camX, (cz + 0.5) * s - camZ);
        if (d > r + s * 0.71) continue;
        if (!this.cells.has(this.key(cx, cz))) wanted.push([d, cx, cz]);
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of wanted) {
      if (created >= maxNewCells) break;
      this.cells.set(this.key(cx, cz), this.loadCell(cx, cz));
      created++;
    }
    const detail = config.world.treeDetailDistance;
    for (const cell of [...this.cells.values()]) {
      const d = Math.hypot(cell.centerX - camX, cell.centerZ - camZ);
      if (d > r + s * 1.3) {
        this.unloadCell(cell);
        continue;
      }
      const detailed = d < detail + s * 0.71;
      if (detailed !== cell.detailed) {
        cell.detailed = detailed;
        for (const mesh of cell.near) {
          // Far cells keep rocks; trees, bushes and stumps switch to the cone mesh.
          const t = TYPES[this.geos.indexOf(mesh.geometry)];
          mesh.visible = detailed || t.startsWith('rock');
        }
        if (cell.far) cell.far.visible = !detailed;
      }
    }
  }

  /** Tree under a collider, if any. */
  treeOf(c: Collider): TreeRef | null {
    return c.kind === 'tree' ? (c.owner as TreeRef) : null;
  }

  /** Trees within a radius (camera occlusion fading). */
  forEachTreeNear(x: number, z: number, r: number, fn: (t: TreeRef) => void): void {
    const s = this.size;
    for (let cz = Math.floor((z - r) / s); cz <= Math.floor((z + r) / s); cz++) {
      for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell) continue;
        for (const t of cell.trees)
          if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && !this.broken.has(t.id)) fn(t);
      }
    }
  }

  /** Scales a tree instance (camera occlusion fading); 1 = normal. */
  setTreeScale(t: TreeRef, k: number): void {
    if (this.broken.has(t.id)) return;
    const slot = t.cell.treeSlots[t.index];
    slot.mesh.getMatrixAt(slot.slot, m2);
    m2.decompose(pv2, q, sv2);
    m.compose(pv2, q, sv.setScalar(t.scale * k));
    slot.mesh.setMatrixAt(slot.slot, m);
    slot.mesh.instanceMatrix.needsUpdate = true;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.shadows = preset.shadows;
    for (const cell of this.cells.values())
      for (const mesh of cell.near) mesh.castShadow = this.shadows && !!mesh.userData.castShadow;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  dispose(): void {
    for (const cell of [...this.cells.values()]) this.unloadCell(cell);
    this.geos.forEach((g) => g.dispose());
    this.farGeo.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

const m2 = new Matrix4();
const pv2 = new Vector3();
const sv2 = new Vector3();
