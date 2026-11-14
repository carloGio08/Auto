import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshLambertMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  type BufferGeometry,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { config, type QualityPreset } from '../config';
import type { ResolvedPalette } from '../data/palette';
import { undergrowth } from '../data/vegetation';
import type { Course } from '../terrain/course';
import type { PatchBackend } from '../terrain/terrainService';
import { applyAtmosphere } from './atmosphere';
import { COVER_STRIDE, placeCover, type CoverData } from './coverPlacement';
import { RICH_STRIDE } from './richness';
import { PropGeometry } from './propGeometry';

interface Tile {
  tx: number;
  tz: number;
  key: number;
  cx: number;
  cz: number;
  data: Float32Array | null;
  /** Distance to the camera at the last refill (m). */
  dist: number;
  /** Richness records of the tile's cells (debug probe). */
  cells: Float32Array | null;
  asked: boolean;
}

const m = new Matrix4();
const q = new Quaternion();
const pv = new Vector3();
const sv = new Vector3();
const yAxis = new Vector3(0, 1, 0);

const uniforms = {
  uCoverCam: { value: new Vector3() },
  uTime: { value: 0 },
  uWind: { value: 1 },
};

/**
 * Vertex code shared by the colour and shadow-depth materials: each instance has its own
 * reach (`aReach`, m) and shrinks to nothing as the camera distance approaches it, so the
 * density thins smoothly with distance and nothing pops; wind bends the tops (local y).
 */
function patchVertex(shader: WebGLProgramParametersWithUniforms, wind: boolean): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
uniform vec3 uCoverCam;
uniform float uTime;
uniform float uWind;
attribute float aReach;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
vec4 coverOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#else
vec4 coverOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#endif
float coverD = distance(coverOrigin.xz, uCoverCam.xz);
transformed *= 1.0 - smoothstep(aReach * 0.72, aReach, coverD);
${
  wind
    ? `float sway = sin(uTime * 1.9 + coverOrigin.x * 0.31 + coverOrigin.z * 0.23)
  + 0.4 * sin(uTime * 3.7 + coverOrigin.x * 0.9);
transformed.x += sway * uWind * 0.09 * position.y * position.y;
transformed.z += sway * uWind * 0.05 * position.y * position.y;`
    : ''
}`,
    );
}

function coverMaterial(wind: boolean): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    patchVertex(shader, wind);
  };
  mat.customProgramCacheKey = () => (wind ? 'cover-wind' : 'cover');
  return mat;
}

function coverDepth(wind: boolean): MeshDepthMaterial {
  const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  mat.onBeforeCompile = (shader) => patchVertex(shader, wind);
  mat.customProgramCacheKey = () => (wind ? 'cover-depth-wind' : 'cover-depth');
  return mat;
}

/**
 * Ground cover near the camera: grass tufts, clustered flower patches (yellow, red, purple,
 * white), bushes, ferns, logs, stumps and pebbles along the trails. Placed per 64 m tile in
 * the terrain worker (deterministic), drawn with one global instanced mesh per kind whose
 * capacity is the preset cap (grass / flowers / other). Refilled in place as the camera moves:
 * every instance has a reach between 30 % and 100 % of the cover distance, so the density is
 * strongest near the camera and fades with distance. When a cap is hit the distance shrinks.
 */
export class GroundCover {
  readonly group = new Group();
  private readonly geos: BufferGeometry[];
  private readonly meshes: InstancedMesh[] = [];
  private readonly reach: InstancedBufferAttribute[] = [];
  private readonly mats: Material[] = [];
  private readonly tiles = new Map<number, Tile>();
  private readonly size = config.world.coverTileSize;
  private lastX = 1e9;
  private lastZ = 1e9;
  private dirty = true;
  /** Cover distance scale under the caps (1 = preset distance). */
  scale = 1;
  /** Instances drawn per cap group at the last refill. */
  readonly counts = { grass: 0, flowers: 0, cover: 0 };
  private syncLoad = false;

  constructor(
    private readonly course: Course,
    private preset: QualityPreset,
    palette: ResolvedPalette,
    private readonly backend: PatchBackend | null = null,
  ) {
    this.group.name = 'groundCover';
    const g = new PropGeometry(palette);
    this.geos = undergrowth.map((u) => g.undergrowth(u.kind));
    const windMat = coverMaterial(true);
    const stillMat = coverMaterial(false);
    const windDepth = coverDepth(true);
    const stillDepth = coverDepth(false);
    this.mats.push(windMat, stillMat, windDepth, stillDepth);
    this.build(windMat, stillMat, windDepth, stillDepth);
    uniforms.uWind.value = preset.wind ? 1 : 0;
  }

  private capOf(group: 'grass' | 'flowers' | 'cover'): number {
    const p = this.preset;
    const thin = this.degrade >= 2 && group !== 'cover' ? 0.6 : 1;
    const cap =
      group === 'grass' ? p.grassLimit : group === 'flowers' ? p.flowerLimit : p.coverLimit;
    return Math.floor(cap * thin);
  }

  private degrade = 0;

  /** Weak devices: 1 no wind, 2 grass and flowers capped at 60 %. */
  setDegrade(level: number): void {
    this.degrade = level;
    uniforms.uWind.value = this.preset.wind && level < 1 ? 1 : 0;
    this.dirty = true;
  }

  private build(
    windMat: Material,
    stillMat: Material,
    windDepth: Material,
    stillDepth: Material,
  ): void {
    undergrowth.forEach((u, k) => {
      const cap = Math.max(1, this.capOf(u.cap));
      const im = new InstancedMesh(this.geos[k], u.wind ? windMat : stillMat, cap);
      const attr = new InstancedBufferAttribute(new Float32Array(cap), 1);
      attr.setUsage(DynamicDrawUsage);
      im.geometry = im.geometry.clone();
      im.geometry.setAttribute('aReach', attr);
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = this.preset.shadows && u.shadow;
      im.customDepthMaterial = u.wind ? windDepth : stillDepth;
      im.name = `cover-${u.kind}`;
      this.meshes.push(im);
      this.reach.push(attr);
      this.group.add(im);
    });
  }

  private get distance(): number {
    return this.preset.undergrowthDistance * this.scale;
  }

  private tile(tx: number, tz: number): Tile {
    const key = (tx + 4096) * 8192 + (tz + 4096);
    let t = this.tiles.get(key);
    if (!t) {
      t = {
        tx,
        tz,
        key,
        cx: (tx + 0.5) * this.size,
        cz: (tz + 0.5) * this.size,
        data: null,
        cells: null,
        dist: 0,
        asked: false,
      };
      this.tiles.set(key, t);
    }
    return t;
  }

  private ask(t: Tile): void {
    if (t.asked) return;
    t.asked = true;
    const done = (d: CoverData): void => {
      if (!this.tiles.has(t.key)) return;
      t.data = d.items;
      t.cells = d.cells;
      this.dirty = true;
    };
    const density = this.preset.propDensity;
    if (this.backend && !this.syncLoad)
      this.backend.requestCover(t.tx, t.tz, this.size, density, done);
    else done(placeCover(this.course, t.tx, t.tz, this.size, density));
  }

  /** Loads the tiles around a point synchronously (teleports, menu, tests). */
  prebuild(x: number, z: number): void {
    this.syncLoad = true;
    this.update(x, z, 0);
    this.syncLoad = false;
  }

  update(camX: number, camZ: number, time: number): void {
    uniforms.uCoverCam.value.set(camX, 0, camZ);
    uniforms.uTime.value = time;
    const R = this.distance;
    const s = this.size;
    const span = Math.ceil(R / s) + 1;
    const ctx = Math.floor(camX / s);
    const ctz = Math.floor(camZ / s);
    const diag = s * 0.71;
    for (let dz = -span; dz <= span; dz++)
      for (let dx = -span; dx <= span; dx++) {
        const cx = (ctx + dx + 0.5) * s;
        const cz = (ctz + dz + 0.5) * s;
        if (Math.hypot(cx - camX, cz - camZ) > R + diag) continue;
        this.ask(this.tile(ctx + dx, ctz + dz));
      }
    for (const t of this.tiles.values())
      if (Math.hypot(t.cx - camX, t.cz - camZ) > R + diag + 2 * s) this.tiles.delete(t.key);
    if (this.dirty || Math.hypot(camX - this.lastX, camZ - this.lastZ) > 8) this.refill(camX, camZ);
  }

  private readonly fill = new Int32Array(undergrowth.length);
  private readonly order: Tile[] = [];

  private refill(camX: number, camZ: number): void {
    this.dirty = false;
    this.lastX = camX;
    this.lastZ = camZ;
    const R = this.distance;
    const fill = this.fill;
    fill.fill(0);
    const used = { grass: 0, flowers: 0, cover: 0 };
    let over = false;
    // Nearest tiles first: when a cap is hit, it is the far instances that are left out.
    const order = this.order;
    order.length = 0;
    for (const t of this.tiles.values()) {
      t.dist = Math.hypot(t.cx - camX, t.cz - camZ);
      if (t.data && t.dist <= R + this.size) order.push(t);
    }
    order.sort((a, b) => a.dist - b.dist);
    for (const t of order) {
      const d = t.data!;
      for (let k = 0; k < d.length; k += COVER_STRIDE) {
        const kind = d[k];
        const u = undergrowth[kind];
        // Per-instance reach: 30–100 % of the distance (denser near the camera).
        const reach = R * u.reach * (0.3 + 0.7 * d[k + 5]);
        const dx = d[k + 1] - camX;
        const dz = d[k + 3] - camZ;
        if (dx * dx + dz * dz > (reach + 8) * (reach + 8)) continue;
        if (used[u.cap] >= this.capOf(u.cap)) {
          over = true;
          continue;
        }
        used[u.cap]++;
        const slot = fill[kind]++;
        const sc = d[k + 4];
        q.setFromAxisAngle(yAxis, d[k + 5] * 6.2832 * 7);
        m.compose(pv.set(d[k + 1], d[k + 2], d[k + 3]), q, sv.set(sc, sc, sc));
        this.meshes[kind].setMatrixAt(slot, m);
        this.reach[kind].setX(slot, reach);
      }
    }
    this.meshes.forEach((im, kind) => {
      im.count = fill[kind];
      im.instanceMatrix.needsUpdate = true;
      this.reach[kind].needsUpdate = true;
    });
    this.counts.grass = used.grass;
    this.counts.flowers = used.flowers;
    this.counts.cover = used.cover;
    // Caps: shrink the distance when over, relax it back when well under.
    const full = Math.max(
      used.grass / Math.max(1, this.preset.grassLimit),
      used.flowers / Math.max(1, this.preset.flowerLimit),
      used.cover / Math.max(1, this.preset.coverLimit),
    );
    if (over) this.scale = Math.max(0.4, this.scale * 0.9);
    else if (full < 0.8 && this.scale < 1) this.scale = Math.min(1, this.scale * 1.04);
  }

  /**
   * Richness record and instances per kind of the cover cell containing (x, z) (debug probe),
   * or null when its tile is not loaded.
   */
  cellAt(x: number, z: number): { record: Float32Array; kinds: number[] } | null {
    const s = this.size;
    const tx = Math.floor(x / s);
    const tz = Math.floor(z / s);
    const t = this.tiles.get((tx + 4096) * 8192 + (tz + 4096));
    if (!t?.data || !t.cells) return null;
    const nc = Math.round(Math.sqrt(t.cells.length / RICH_STRIDE));
    const cs = s / nc;
    const ci = Math.min(nc - 1, Math.floor((x - tx * s) / cs));
    const cj = Math.min(nc - 1, Math.floor((z - tz * s) / cs));
    const c = cj * nc + ci;
    const kinds = undergrowth.map(() => 0);
    const x0 = tx * s + ci * cs;
    const z0 = tz * s + cj * cs;
    for (let k = 0; k < t.data.length; k += COVER_STRIDE) {
      const px = t.data[k + 1];
      const pz = t.data[k + 3];
      if (px >= x0 && px < x0 + cs && pz >= z0 && pz < z0 + cs) kinds[t.data[k]]++;
    }
    return { record: t.cells.subarray(c * RICH_STRIDE, (c + 1) * RICH_STRIDE), kinds };
  }

  /** Instances currently drawn (all kinds). */
  get visible(): number {
    return this.counts.grass + this.counts.flowers + this.counts.cover;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    uniforms.uWind.value = preset.wind && this.degrade < 1 ? 1 : 0;
    // Caps may change: rebuild the meshes (geometries and materials are kept).
    const [windMat, stillMat, windDepth, stillDepth] = this.mats;
    for (const im of this.meshes) {
      im.removeFromParent();
      im.geometry.dispose();
      im.dispose();
    }
    this.meshes.length = 0;
    this.reach.length = 0;
    this.build(windMat, stillMat, windDepth, stillDepth);
    this.scale = 1;
    this.dirty = true;
  }

  dispose(): void {
    for (const im of this.meshes) {
      im.removeFromParent();
      im.geometry.dispose();
      im.dispose();
    }
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((mt) => mt.dispose());
    this.tiles.clear();
    this.group.removeFromParent();
  }
}
