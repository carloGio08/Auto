import { applyAtmosphere } from './atmosphere';
import {
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { config, type QualityPreset } from '../config';
import type { ResolvedPalette } from '../data/palette';
import { treeSpecies, undergrowth } from '../data/vegetation';
import type { Course } from '../terrain/course';
import type { PatchBackend } from '../terrain/terrainService';
import type { Collider, CollisionWorld } from './colliders';
import { PropGeometry, type TreeTier } from './propGeometry';
import {
  BLOB_STRIDE,
  placeCell,
  ROCK_STRIDE,
  ROCK_TYPES,
  TREE_AGES,
  TREE_STRIDE,
  UNDER_STRIDE,
  type CellData,
} from './propPlacement';

/** Tree record of a loaded cell (also the collider owner). */
export interface TreeRef {
  cell: PropCell;
  index: number;
  tier: TreeTier;
  species: number;
  x: number;
  y: number;
  z: number;
  /** Real height and crown width (m). */
  height: number;
  width: number;
  /** Size relative to the reference tree of its tier (debris pieces scale with it). */
  scale: number;
  /** Stable id: survives cell unload/reload so broken trees stay broken. */
  id: number;
}

export interface PropCell {
  cx: number;
  cz: number;
  key: number;
  centerX: number;
  centerZ: number;
  data: CellData | null;
  /** Level of the data asked for (far cells only get canopy masses). */
  asked: 'none' | 'far' | 'full';
  trees: TreeRef[];
  /** Detailed meshes (near): one per species variant, plus stumps. */
  near: InstancedMesh[] | null;
  slots: { mesh: InstancedMesh; slot: number }[];
  rocks: InstancedMesh[] | null;
  under: InstancedMesh[] | null;
  colliders: Collider[] | null;
}

/** Reference heights of the tiers the debris pieces were modelled for (m). */
const TIER_REF: Record<TreeTier, number> = { young: 3.2, medium: 6.5, old: 10.5 };

const m = new Matrix4();
const q = new Quaternion();
const sv = new Vector3();
const pv = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const tmpC = new Color();

interface FadeUniforms {
  uFadeCam: { value: Vector3 };
  uFadeIn: { value: [number, number] };
  uFadeOut: { value: [number, number] };
}

/**
 * Material with a per-instance distance fade: instances dissolve with an ordered dither
 * between two distances (no pop-in, no transparency sorting), or shrink (`shrink`) for the
 * undergrowth.
 */
function fadeMaterial(u: FadeUniforms, shrink = false): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uFadeCam;
uniform vec2 uFadeIn;
uniform vec2 uFadeOut;
varying float vFade;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vec4 fadeOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#else
vec4 fadeOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#endif
float fadeD = distance(fadeOrigin.xz, uFadeCam.xz);
vFade = smoothstep(uFadeIn.x, uFadeIn.y, fadeD) * (1.0 - smoothstep(uFadeOut.x, uFadeOut.y, fadeD));
${shrink ? 'transformed *= vFade; vFade = 1.0;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (vFade < 0.999 && vFade <= ign) discard;`,
      );
  };
  mat.customProgramCacheKey = () => (shrink ? 'fade-shrink' : 'fade-dither');
  return mat;
}

const uniforms = (): FadeUniforms => ({
  uFadeCam: { value: new Vector3() },
  uFadeIn: { value: [-2, -1] },
  uFadeOut: { value: [1e9, 1e9 + 1] },
});

/**
 * Vegetation and rocks, streamed per cell around the camera.
 *
 * - Placement (`propPlacement.ts`) is computed in the terrain worker (or synchronously when
 *   there is none): trees on a Poisson disk with ecological density, undergrowth, rocks and
 *   canopy masses.
 * - Three tree LODs: full species models near the jeep (per cell, destructible, colliders
 *   only within `colliderRadius` of the jeep), simplified crowns in the middle distance and
 *   merged low-poly canopy masses far away, both in a few global instanced meshes. LODs
 *   cross-fade with an ordered dither on the instance distance; the undergrowth grows in.
 * - The middle range shrinks when the visible trees exceed the preset limit.
 */
export class Props {
  readonly group = new Group();
  private readonly geo: PropGeometry;
  /** Detailed geometries per species × snowy, low geometries per species. */
  private readonly speciesGeo: BufferGeometry[] = [];
  private readonly lowGeo: BufferGeometry[] = [];
  private readonly rockGeo: BufferGeometry[];
  private readonly underGeo: BufferGeometry[];
  private readonly stumpGeo: BufferGeometry;
  private readonly canopyGeo: BufferGeometry;
  private readonly nearU = uniforms();
  private readonly midU = uniforms();
  private readonly farU = uniforms();
  private readonly underU = uniforms();
  private readonly nearMat: MeshLambertMaterial;
  private readonly midMat: MeshLambertMaterial;
  private readonly farMat: MeshLambertMaterial;
  private readonly underMat: MeshLambertMaterial;
  private readonly rockMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly cells = new Map<number, PropCell>();
  /** Ids of trees broken during this run (become stumps). */
  readonly broken = new Set<number>();
  private readonly size = config.world.propCellSize;
  /** Global middle-distance meshes (one per species) and canopy masses. */
  private readonly mid: InstancedMesh[] = [];
  private readonly far: InstancedMesh;
  private globalDirty = true;
  /** Middle-range scale under the tree limit (1 = preset distance). */
  midScale = 1;
  /** Visible tree instances (near + middle). */
  visibleTrees = 0;
  private shadows: boolean;
  private readonly snowLine: number;
  private readonly canopyLow: Color;
  private readonly canopyHigh: Color;
  private focusX = 0;
  private focusZ = 0;

  constructor(
    private readonly course: Course,
    private readonly colliders: CollisionWorld,
    private preset: QualityPreset,
    palette: ResolvedPalette,
    private readonly backend: PatchBackend | null = null,
  ) {
    this.group.name = 'props';
    const g = (this.geo = new PropGeometry(palette));
    for (const sp of treeSpecies) {
      const tones = sp.foliage.tones.map((t) => palette[sp.foliage.key][t]);
      this.speciesGeo.push(
        g.species(sp.shape, tones, 0, false),
        g.species(sp.shape, tones, 1, true),
      );
      this.lowGeo.push(g.speciesLow(sp.shape, tones[0]));
    }
    this.rockGeo = ROCK_TYPES.map((t) =>
      t === 'rockSlab'
        ? g.rockSlab()
        : t === 'rockSpire'
          ? g.rockSpire()
          : t === 'rockRound'
            ? g.rockRound()
            : g.rock(ROCK_TYPES.indexOf(t)),
    );
    this.underGeo = undergrowth.map((u) => g.undergrowth(u.kind));
    this.stumpGeo = g.stump();
    this.canopyGeo = g.canopy();
    this.canopyLow = palette.foliage[1].clone();
    this.canopyHigh = palette.foliage[0].clone().lerp(palette.dryGrass[1], 0.25);
    this.nearMat = fadeMaterial(this.nearU);
    this.midMat = fadeMaterial(this.midU);
    this.farMat = fadeMaterial(this.farU);
    this.underMat = fadeMaterial(this.underU, true);
    this.shadows = preset.shadows;
    this.snowLine = course.def.biomes.snowLine;
    const limit = preset.treeLimit;
    this.lowGeo.forEach((geo) => {
      const im = new InstancedMesh(geo, this.midMat, limit);
      im.count = 0;
      im.frustumCulled = false;
      im.name = 'trees-mid';
      this.mid.push(im);
      this.group.add(im);
    });
    this.far = new InstancedMesh(this.canopyGeo, this.farMat, preset.canopyLimit);
    this.far.instanceColor = new InstancedBufferAttribute(
      new Float32Array(preset.canopyLimit * 3),
      3,
    );
    this.far.count = 0;
    this.far.frustumCulled = false;
    this.far.name = 'canopy-far';
    this.group.add(this.far);
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /** Distances (m): detailed trees, middle range, canopy masses, undergrowth, colliders. */
  private get ranges(): { near: number; mid: number; far: number; under: number; col: number } {
    const p = this.preset;
    return {
      near: p.treeNear,
      mid: Math.max(p.treeNear + 80, p.propDistance * this.midScale),
      far: p.canopyDistance,
      under: p.undergrowthDistance,
      col: config.world.colliderRadius,
    };
  }

  // --- Cell data ---------------------------------------------------------------------------

  private ask(cell: PropCell, full: boolean): void {
    const want = full ? 'full' : 'far';
    if (cell.asked === 'full' || cell.asked === want) return;
    cell.asked = want;
    const density = this.preset.propDensity;
    const done = (d: CellData): void => {
      if (!this.cells.has(cell.key)) return;
      if (cell.data?.full && !d.full) return;
      cell.data = d;
      this.globalDirty = true;
    };
    if (this.backend && !(this.syncLoad && full))
      this.backend.requestCell(cell.cx, cell.cz, this.size, density, full, done);
    else done(placeCell(this.course, cell.cx, cell.cz, this.size, density, full));
  }

  private makeCell(cx: number, cz: number): PropCell {
    const cell: PropCell = {
      cx,
      cz,
      key: this.key(cx, cz),
      centerX: (cx + 0.5) * this.size,
      centerZ: (cz + 0.5) * this.size,
      data: null,
      asked: 'none',
      trees: [],
      near: null,
      slots: [],
      rocks: null,
      under: null,
      colliders: null,
    };
    this.cells.set(cell.key, cell);
    return cell;
  }

  /** Tree records of a cell (created once its full data is there). */
  private ensureTrees(cell: PropCell): void {
    if (cell.trees.length || !cell.data?.full) return;
    const t = cell.data.trees;
    for (let i = 0, k = 0; k < t.length; i++, k += TREE_STRIDE) {
      const tier = TREE_AGES[t[k + 1]] as TreeTier;
      cell.trees.push({
        cell,
        index: i,
        tier,
        species: t[k],
        x: t[k + 2],
        y: t[k + 3],
        z: t[k + 4],
        height: t[k + 5],
        width: t[k + 6],
        scale: t[k + 5] / TIER_REF[tier],
        id: cell.key * 8192 + i,
      });
    }
  }

  // --- Near (detailed) ------------------------------------------------------------------

  private buildNear(cell: PropCell): void {
    if (cell.near || !cell.data?.full) return;
    this.ensureTrees(cell);
    const t = cell.data.trees;
    const byGeo = new Map<number, number[]>();
    cell.trees.forEach((tr, i) => {
      const sp = treeSpecies[tr.species];
      const snowy = sp.snowCap !== undefined && tr.y > this.snowLine - sp.snowCap ? 1 : 0;
      const gi = tr.species * 2 + snowy;
      const l = byGeo.get(gi) ?? [];
      l.push(i);
      byGeo.set(gi, l);
    });
    cell.near = [];
    cell.slots = new Array(cell.trees.length);
    for (const [gi, list] of byGeo) {
      const im = new InstancedMesh(this.speciesGeo[gi], this.nearMat, list.length);
      list.forEach((ti, slot) => {
        const k = ti * TREE_STRIDE;
        this.compose(t[k + 2], t[k + 3], t[k + 4], t[k + 6], t[k + 5], t[k + 7]);
        im.setMatrixAt(slot, m);
        cell.slots[ti] = { mesh: im, slot };
      });
      this.finish(im, true);
      cell.near.push(im);
    }
    // Stumps: one slot per tree so breaking never allocates.
    const stumps = new InstancedMesh(this.stumpGeo, this.rockMat, Math.max(1, cell.trees.length));
    stumps.count = 0;
    stumps.userData.stump = true;
    this.finish(stumps, false);
    cell.near.push(stumps);
    for (const tr of cell.trees) if (this.broken.has(tr.id)) this.applyBroken(tr);
  }

  private compose(x: number, y: number, z: number, w: number, h: number, rot: number): void {
    q.setFromAxisAngle(yAxis, rot);
    m.compose(pv.set(x, y, z), q, sv.set(w, h, w));
  }

  private finish(im: InstancedMesh, castShadow: boolean): void {
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.matrixAutoUpdate = false;
    im.castShadow = this.shadows && castShadow;
    im.userData.castShadow = castShadow;
    this.group.add(im);
  }

  private dropNear(cell: PropCell): void {
    if (!cell.near) return;
    for (const im of cell.near) {
      im.removeFromParent();
      im.dispose();
    }
    cell.near = null;
    cell.slots = [];
  }

  // --- Rocks, undergrowth, colliders ----------------------------------------------------

  private buildRocks(cell: PropCell): void {
    if (cell.rocks || !cell.data?.full) return;
    const r = cell.data.rocks;
    cell.rocks = [];
    const byType: number[][] = ROCK_TYPES.map(() => []);
    for (let k = 0; k < r.length; k += ROCK_STRIDE) byType[r[k]].push(k);
    byType.forEach((list, t) => {
      if (!list.length) return;
      const im = new InstancedMesh(this.rockGeo[t], this.rockMat, list.length);
      list.forEach((k, slot) => {
        const s = r[k + 4];
        q.setFromAxisAngle(yAxis, r[k + 5]);
        m.compose(pv.set(r[k + 1], r[k + 2], r[k + 3]), q, sv.set(s * 1.1, s * 0.9, s));
        im.setMatrixAt(slot, m);
      });
      this.finish(im, true);
      cell.rocks!.push(im);
    });
  }

  private buildUnder(cell: PropCell): void {
    if (cell.under || !cell.data?.full) return;
    const u = cell.data.under;
    cell.under = [];
    const byKind: number[][] = undergrowth.map(() => []);
    for (let k = 0; k < u.length; k += UNDER_STRIDE) byKind[u[k]].push(k);
    byKind.forEach((list, kind) => {
      if (!list.length) return;
      const im = new InstancedMesh(this.underGeo[kind], this.underMat, list.length);
      list.forEach((k, slot) => {
        const s = u[k + 4];
        q.setFromAxisAngle(yAxis, u[k + 5]);
        m.compose(pv.set(u[k + 1], u[k + 2], u[k + 3]), q, sv.setScalar(s));
        im.setMatrixAt(slot, m);
      });
      this.finish(im, false);
      cell.under!.push(im);
    });
  }

  private dropList(list: InstancedMesh[] | null): null {
    if (list)
      for (const im of list) {
        im.removeFromParent();
        im.dispose();
      }
    return null;
  }

  private addColliders(cell: PropCell): void {
    if (cell.colliders || !cell.data?.full) return;
    this.ensureTrees(cell);
    cell.colliders = [];
    for (const tr of cell.trees) {
      const c = this.colliders.addCircle(
        'tree',
        tr.x,
        tr.z,
        Math.max(0.12, tr.height * 0.024),
        tr.y - 1,
        tr.y + tr.height,
      );
      c.owner = tr;
      if (this.broken.has(tr.id)) c.enabled = false;
      cell.colliders.push(c);
    }
    const r = cell.data.rocks;
    for (let k = 0; k < r.length; k += ROCK_STRIDE) {
      if (!r[k + 6]) continue;
      const s = r[k + 4];
      const y = r[k + 2] + 0.25 * s;
      cell.colliders.push(
        this.colliders.addCircle('rock', r[k + 1], r[k + 3], 0.95 * s, y - 1, y + 1.2 * s),
      );
    }
  }

  private dropColliders(cell: PropCell): void {
    if (!cell.colliders) return;
    for (const c of cell.colliders) this.colliders.remove(c);
    cell.colliders = null;
  }

  // --- Global middle and far layers -----------------------------------------------------

  /** Rebuilds the middle-distance trees and the canopy masses from the loaded cells. */
  private rebuildGlobal(camX: number, camZ: number): void {
    const r = this.ranges;
    const counts = this.mid.map(() => 0);
    const cap = this.preset.treeLimit;
    let total = 0;
    const midR = r.mid + 60;
    for (const cell of this.cells.values()) {
      if (!cell.data?.full) continue;
      const t = cell.data.trees;
      for (let k = 0, i = 0; k < t.length; k += TREE_STRIDE, i++) {
        const d = Math.hypot(t[k + 2] - camX, t[k + 4] - camZ);
        if (d > midR || d < r.near - 40) continue;
        if (this.broken.has(cell.key * 8192 + i)) continue;
        const sp = t[k];
        if (counts[sp] >= cap) continue;
        this.compose(t[k + 2], t[k + 3], t[k + 4], t[k + 6], t[k + 5], t[k + 7]);
        this.mid[sp].setMatrixAt(counts[sp]++, m);
        total++;
      }
    }
    this.mid.forEach((im, i) => {
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
    });
    // Canopy masses beyond the middle range.
    let nb = 0;
    const capB = this.preset.canopyLimit;
    const colors = this.far.instanceColor!;
    for (const cell of this.cells.values()) {
      if (!cell.data) continue;
      const b = cell.data.blobs;
      for (let k = 0; k < b.length && nb < capB; k += BLOB_STRIDE) {
        const d = Math.hypot(b[k] - camX, b[k + 2] - camZ);
        if (d < r.mid - 100 || d > r.far) continue;
        q.identity();
        m.compose(pv.set(b[k], b[k + 1], b[k + 2]), q, sv.set(b[k + 3], b[k + 4], b[k + 3]));
        this.far.setMatrixAt(nb, m);
        tmpC.copy(this.canopyLow).lerp(this.canopyHigh, Math.max(0, b[k + 5] - 0.4) / 0.6);
        colors.setXYZ(nb, tmpC.r, tmpC.g, tmpC.b);
        nb++;
      }
    }
    this.far.count = nb;
    this.far.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    // Visible trees: detailed ones of the near cells plus the middle layer.
    let near = 0;
    for (const cell of this.cells.values()) if (cell.near) near += cell.trees.length;
    this.visibleTrees = total + near;
  }

  // --- Streaming --------------------------------------------------------------------------

  /**
   * Asks the worker for every cell needed around a point and yields the progress (0..1)
   * until the detailed ones have arrived (loading screen).
   */
  *prebuildAsync(x: number, z: number): Generator<number> {
    for (;;) {
      this.update(x, z, x, z);
      this.backend?.pump(12);
      let asked = 0;
      let ready = 0;
      for (const c of this.cells.values())
        if (c.asked === 'full') {
          asked++;
          if (c.data?.full) ready++;
        }
      yield asked ? ready / asked : 1;
      if (ready === asked) break;
    }
    this.update(x, z, x, z);
  }

  /** Loads the detailed cells around a point synchronously (menu, teleports). */
  prebuild(x: number, z: number): void {
    this.syncLoad = true;
    this.update(x, z, x, z);
    this.syncLoad = false;
    this.update(x, z, x, z);
  }

  /**
   * Streams cells in and out around the camera, builds or drops each LOD layer by distance,
   * keeps colliders only near the jeep (`focusX/Z`), and enforces the tree limit.
   */
  update(camX: number, camZ: number, focusX = camX, focusZ = camZ): void {
    this.focusX = focusX;
    this.focusZ = focusZ;
    const s = this.size;
    const r = this.ranges;
    const diag = s * 0.71;
    // Fade bands follow the camera.
    for (const u of [this.nearU, this.midU, this.farU, this.underU])
      u.uFadeCam.value.set(camX, 0, camZ);
    this.nearU.uFadeOut.value = [r.near, r.near + 30];
    this.midU.uFadeIn.value = [r.near, r.near + 30];
    this.midU.uFadeOut.value = [r.mid, r.mid + 60];
    this.farU.uFadeIn.value = [r.mid, r.mid + 60];
    this.underU.uFadeOut.value = [r.under * 0.75, r.under];
    const span = Math.ceil(r.far / s) + 1;
    const ccx = Math.floor(camX / s);
    const ccz = Math.floor(camZ / s);
    for (let dz = -span; dz <= span; dz++)
      for (let dx = -span; dx <= span; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const d = Math.hypot((cx + 0.5) * s - camX, (cz + 0.5) * s - camZ);
        if (d > r.far + diag) continue;
        const cell = this.cells.get(this.key(cx, cz)) ?? this.makeCell(cx, cz);
        this.ask(cell, d < r.mid + 60 + diag);
      }
    for (const cell of [...this.cells.values()]) {
      const d = Math.hypot(cell.centerX - camX, cell.centerZ - camZ);
      if (d > r.far + diag * 1.5) {
        this.unloadCell(cell);
        continue;
      }
      if (!cell.data?.full) continue;
      if (d < r.near + 30 + diag) this.buildNear(cell);
      else if (d > r.near + 80 + diag) this.dropNear(cell);
      if (d < r.mid + 60 + diag) this.buildRocks(cell);
      else cell.rocks = this.dropList(cell.rocks);
      if (d < r.under + diag) this.buildUnder(cell);
      else if (d > r.under + 40 + diag) cell.under = this.dropList(cell.under);
      const fd = Math.hypot(cell.centerX - focusX, cell.centerZ - focusZ);
      if (fd < r.col + diag) this.addColliders(cell);
      else if (fd > r.col + 60 + diag) this.dropColliders(cell);
    }
    this.backend?.pump(0);
    // Rebuild the global layers when cells changed or the camera moved a lot.
    const moved = Math.hypot(camX - this.lastX, camZ - this.lastZ) > 40;
    if (this.globalDirty || moved) {
      this.rebuildGlobal(camX, camZ);
      this.lastX = camX;
      this.lastZ = camZ;
      this.globalDirty = false;
      // Tree limit: shrink the middle range when over, relax it when well under.
      const limit = this.preset.treeLimit;
      if (this.visibleTrees > limit) this.midScale = Math.max(0.35, this.midScale * 0.9);
      else if (this.visibleTrees < limit * 0.8) this.midScale = Math.min(1, this.midScale * 1.05);
    }
  }

  private lastX = 1e9;
  /** Loading screen / teleport: cell data computed synchronously. */
  private syncLoad = false;
  private lastZ = 1e9;

  private unloadCell(cell: PropCell): void {
    this.dropNear(cell);
    cell.rocks = this.dropList(cell.rocks);
    cell.under = this.dropList(cell.under);
    this.dropColliders(cell);
    this.cells.delete(cell.key);
    this.globalDirty = true;
  }

  // --- Trees: breaking, fading, queries ---------------------------------------------------

  /** Hides a tree instance and shows a stump in its place; disables its collider. */
  private applyBroken(t: TreeRef): void {
    const cell = t.cell;
    if (cell.near) {
      const slot = cell.slots[t.index];
      m.makeScale(0, 0, 0);
      slot.mesh.setMatrixAt(slot.slot, m);
      slot.mesh.instanceMatrix.needsUpdate = true;
      const stumps = cell.near[cell.near.length - 1];
      if (stumps.count < stumps.instanceMatrix.count) {
        const k = Math.max(0.4, t.width * 0.06);
        m.compose(
          pv.set(t.x, t.y, t.z),
          q.identity(),
          sv.set(k * 2.4, Math.max(0.6, k * 2), k * 2.4),
        );
        stumps.setMatrixAt(stumps.count++, m);
        stumps.instanceMatrix.needsUpdate = true;
      }
    }
    if (cell.colliders) for (const c of cell.colliders) if (c.owner === t) c.enabled = false;
  }

  /** Breaks a tree: becomes a stump, collider disabled, remembered by id. */
  breakTree(t: TreeRef): void {
    if (this.broken.has(t.id)) return;
    this.broken.add(t.id);
    this.applyBroken(t);
    this.globalDirty = true;
  }

  /** Restores every tree (run restart). */
  restoreTrees(): void {
    this.broken.clear();
    for (const cell of [...this.cells.values()]) this.unloadCell(cell);
  }

  /** Tree under a collider, if any. */
  treeOf(c: Collider): TreeRef | null {
    return c.kind === 'tree' ? (c.owner as TreeRef) : null;
  }

  /** Detailed trees within a radius (camera occlusion fading, tests). */
  forEachTreeNear(x: number, z: number, r: number, fn: (t: TreeRef) => void): void {
    const s = this.size;
    for (let cz = Math.floor((z - r) / s); cz <= Math.floor((z + r) / s); cz++)
      for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell?.near) continue;
        for (const t of cell.trees)
          if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && !this.broken.has(t.id)) fn(t);
      }
  }

  /** Scales a detailed tree (camera occlusion fading); 1 = normal. */
  setTreeScale(t: TreeRef, k: number): void {
    if (this.broken.has(t.id) || !t.cell.near) return;
    const slot = t.cell.slots[t.index];
    const r = t.cell.data!.trees[t.index * TREE_STRIDE + 7];
    this.compose(t.x, t.y, t.z, t.width * k, t.height * k, r);
    slot.mesh.setMatrixAt(slot.slot, m);
    slot.mesh.instanceMatrix.needsUpdate = true;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.shadows = preset.shadows;
    for (const cell of this.cells.values())
      for (const list of [cell.near, cell.rocks])
        if (list) for (const im of list) im.castShadow = this.shadows && !!im.userData.castShadow;
    this.globalDirty = true;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  /** Jeep position used for the collider radius (last update). */
  get focus(): { x: number; z: number } {
    return { x: this.focusX, z: this.focusZ };
  }

  dispose(): void {
    for (const cell of [...this.cells.values()]) this.unloadCell(cell);
    for (const im of [...this.mid, this.far]) {
      im.removeFromParent();
      im.dispose();
    }
    for (const g of [
      ...this.speciesGeo,
      ...this.lowGeo,
      ...this.rockGeo,
      ...this.underGeo,
      this.stumpGeo,
      this.canopyGeo,
    ])
      g.dispose();
    for (const mat of [this.nearMat, this.midMat, this.farMat, this.underMat, this.rockMat])
      mat.dispose();
    this.group.removeFromParent();
    void this.geo;
  }
}
