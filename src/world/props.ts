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
import { Rng } from '../math/rng';
import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import type { Course } from '../terrain/course';
import type { Collider, CollisionWorld } from './colliders';
import { PropGeometry, type TreeTier } from './propGeometry';

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

interface Instance {
  type: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
}

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

const TYPES = [
  'pineYoung0',
  'pineYoung1',
  'pineMid0',
  'pineMid1',
  'roundMid',
  'pineOld0',
  'pineOld1',
  'pineSnow',
  'bush0',
  'bush1',
  'rock0',
  'rock1',
  'rock2',
  'stump',
] as const;
type PropType = (typeof TYPES)[number];
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
  private readonly forest: Simplex2;
  private readonly clearing: Simplex2;
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
      stump: () => g.stump(),
    };
    this.geos = TYPES.map((t) => builders[t]());
    this.farGeo = g.farTree();
    this.forest = new Simplex2(course.def.seed ^ 0xf0e5);
    this.clearing = new Simplex2(course.def.seed ^ 0xc1ea);
    this.shadows = preset.shadows;
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /** Generates the instances (and colliders) of one cell. */
  private generate(cx: number, cz: number): Instance[] {
    const course = this.course;
    const terrain = course.terrain;
    const def = course.def;
    const b = def.biomes;
    const out: Instance[] = [];
    const rng = new Rng((cx * 73856093) ^ (cz * 19349663) ^ def.seed);
    const density = this.preset.propDensity;
    const x0 = cx * this.size;
    const z0 = cz * this.size;
    const step = 9;
    const lake = def.lake.level;
    const tIndex = (t: PropType): number => TYPES.indexOf(t);
    for (let gz = 0; gz < this.size; gz += step) {
      for (let gx = 0; gx < this.size; gx += step) {
        const x = x0 + gx + rng.range(0, step);
        const z = z0 + gz + rng.range(0, step);
        const roll = rng.next();
        const kindRoll = rng.next();
        const rot = rng.range(0, Math.PI * 2);
        const sc = rng.range(0.8, 1.25);
        if (Math.max(Math.abs(x), Math.abs(z)) > def.halfSize * 1.05) continue;
        const h = terrain.height(x, z);
        const rqd = terrain.lastQuery;
        const roadD = rqd.found ? rqd.distance - rqd.halfWidth : 1e4;
        if (roadD < 2.5) continue;
        if (h < lake + 1.5 || terrain.waterLevel(x, z) > h - 0.3) continue;
        if (Math.hypot(x - course.base.x, z - course.base.z) < course.base.radius + 25) continue;
        if (Math.hypot(x - course.start.x, z - course.start.z) < 40) continue;
        // Slope from a cheap finite difference.
        const hx = terrain.height(x + 1.5, z);
        const hz = terrain.height(x, z + 1.5);
        const slope = Math.hypot(hx - h, hz - h) / 1.5;
        const wob = 28 * Math.sin(x / 240 + z / 610);
        const alt = h + wob;
        // Rocks lining the trail edges and on scree/rock slopes.
        const edge = roadD < 5;
        const rocky = (alt > b.rockLine && slope > 0.25) || slope > 0.75;
        const pRock = (edge ? 0.12 : 0) + (rocky ? 0.22 : 0.025);
        if (roll < pRock * def.props.rocks * density) {
          const s = edge ? rng.range(0.5, 1.1) : rng.range(0.5, 2.4) * (rocky ? 1.3 : 1);
          out.push({
            type: tIndex(kindRoll < 0.33 ? 'rock0' : kindRoll < 0.66 ? 'rock1' : 'rock2'),
            x,
            y: h - 0.25 * s,
            z,
            scale: s,
            rot,
          });
          if (s > 0.6)
            this.pendingColliders.push(['rock', x, z, 0.95 * s, h - 1, h + 1.2 * s, null]);
          continue;
        }
        if (alt > b.treeLine + 60 || slope > 0.85) continue;
        // Forest density: bands by altitude, organic noise, clearings along the trail.
        const forestN = 0.5 + 0.5 * this.forest.fbm(x / 420, z / 420, 3);
        let dens: number;
        if (alt > b.treeLine) dens = 0.08;
        else if (alt > b.denseForestLine) dens = 0.42;
        else if (alt > b.valleyLine) dens = 0.75;
        else dens = 0.18;
        const clearingMask =
          roadD < 45 ? smoothstep(-0.2, 0.25, this.clearing.noise(x / 160, z / 160)) : 1;
        const nearTrail = smoothstep(4, 14, roadD);
        const p =
          dens *
          (0.35 + 0.9 * forestN) *
          clearingMask *
          (0.3 + 0.7 * nearTrail) *
          def.props.trees *
          density;
        if (roll < 0.25 + p * 0.75 && roll > 0.25) {
          // Tier mix: young near the trail (breakable), old deep in the forest.
          const deep = smoothstep(10, 60, roadD) * (alt < b.denseForestLine ? 1 : 0.6);
          const t = kindRoll + deep * 0.25;
          let type: PropType;
          if (alt > b.treeLine - 80)
            type = t > 0.75 ? 'pineSnow' : t > 0.4 ? 'pineMid1' : 'pineYoung1';
          else if (t < 0.32) type = kindRoll < 0.16 ? 'pineYoung0' : 'pineYoung1';
          else if (t < 0.82)
            type =
              alt < b.valleyLine + 150 && kindRoll < 0.55
                ? 'roundMid'
                : kindRoll < 0.6
                  ? 'pineMid0'
                  : 'pineMid1';
          else type = kindRoll < 0.9 ? 'pineOld0' : 'pineOld1';
          out.push({ type: tIndex(type), x, y: h - 0.15, z, scale: sc, rot });
        } else if (roll > 0.94 && alt < b.treeLine) {
          out.push({
            type: tIndex(kindRoll < 0.5 ? 'bush0' : 'bush1'),
            x,
            y: h - 0.05,
            z,
            scale: sc,
            rot,
          });
        }
      }
    }
    return out;
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
