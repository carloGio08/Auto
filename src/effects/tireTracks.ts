import { applyAtmosphere } from '../world/atmosphere';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshLambertMaterial,
  type Color,
} from 'three';
import type { ResolvedPalette } from '../data/palette';
import type { SurfaceId } from '../data/types';

/** Floats per segment for positions / colours / fade (6 vertices × 3). */
const V = 18;

/**
 * Ring buffer of track segments (pure data, no three.js). Each segment is a strip of
 * 6 vertices (left, centre, right at both ends). Slots freed by expiry or distance are
 * reused first (pooling); when none is free the oldest slot of the ring is overwritten.
 */
export class TrackBuffer {
  readonly pos: Float32Array;
  readonly col: Float32Array;
  /** Per vertex: birth time (s), life (s), alpha. */
  readonly fade: Float32Array;
  private readonly cx: Float32Array;
  private readonly cz: Float32Array;
  private readonly death: Float32Array;
  private readonly alive: Uint8Array;
  private readonly free: Int32Array;
  private freeCount = 0;
  private next = 0;
  /** Live segments. */
  count = 0;
  /** Dirty slot range since the last upload (inclusive), -1 when clean. */
  dirtyMin = -1;
  dirtyMax = -1;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * V);
    this.col = new Float32Array(capacity * V);
    this.fade = new Float32Array(capacity * V);
    this.cx = new Float32Array(capacity);
    this.cz = new Float32Array(capacity);
    this.death = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.free = new Int32Array(capacity);
  }

  /** A slot for a new segment: a freed one first, else the next (oldest) of the ring. */
  alloc(): number {
    let i: number;
    if (this.freeCount > 0) i = this.free[--this.freeCount];
    else {
      i = this.next;
      this.next = (this.next + 1) % this.capacity;
    }
    if (!this.alive[i]) this.count++;
    this.alive[i] = 1;
    this.mark(i);
    return i;
  }

  /** Records the centre and expiry of a segment (for distance culling and expiry). */
  meta(i: number, x: number, z: number, death: number): void {
    this.cx[i] = x;
    this.cz[i] = z;
    this.death[i] = death;
  }

  isAlive(i: number): boolean {
    return this.alive[i] === 1;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    const o = i * V;
    for (let k = 2; k < V; k += 3) this.fade[o + k] = 0;
    this.free[this.freeCount++] = i;
    this.mark(i);
  }

  /** Frees expired segments and those farther than `maxDist` from (x, z). */
  sweep(now: number, x: number, z: number, maxDist: number): void {
    const d2 = maxDist * maxDist;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const dx = this.cx[i] - x;
      const dz = this.cz[i] - z;
      if (now >= this.death[i] || dx * dx + dz * dz > d2) this.kill(i);
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) if (this.alive[i]) this.kill(i);
    this.freeCount = 0;
    this.next = 0;
    this.dirtyMin = 0;
    this.dirtyMax = this.capacity - 1;
  }

  private mark(i: number): void {
    if (this.dirtyMin < 0 || i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }
}

/** How tracks look on one surface (colours from the palette). */
interface TrackStyle {
  center: Color;
  edge: Color;
  /** Opacity of a fresh track (0 = no track at all). */
  alpha: number;
  /** Edge opacity relative to the centre. */
  edgeAlpha: number;
  /** Seconds before it has faded away. */
  life: number;
}

/** Per-wheel input for one fixed step. */
export interface WheelTrackInput {
  contact: boolean;
  x: number;
  y: number;
  z: number;
  /** Unit heading of the wheel's motion on the ground. */
  surface: SurfaceId;
  /** 0..1 sliding, 0..2 load relative to static, wheelspin 0..1. */
  skid: number;
  load: number;
  spin: number;
  inWater: boolean;
}

export type TrackSetting = 'off' | 'low' | 'high';

/** Segments per quality level: desktop high / mobile low. */
export const TRACK_CAPACITY: Record<Exclude<TrackSetting, 'off'>, number> = {
  low: 1500,
  high: 4000,
};

const SPACING = 0.4;

/**
 * Tyre tracks: every wheel touching the ground lays a low-poly strip that follows the
 * terrain exactly (heights sampled at its vertices, a few cm above to avoid z-fighting), as
 * wide as the tyre, a segment every 0.4 m. Look per surface from the palette (dark blue-grey
 * grooves with lighter rims in snow, dark mud, darker soil on trails, crushed darker grass,
 * light scratches on gravel, almost nothing on rock, none in water), opacity and width from
 * slip, braking, drifting and load (the handbrake leaves darker, sharper marks; a spinning
 * wheel leaves broken marks). Tracks fade in 60–120 s in the shader, so updates only touch
 * the new segments. One draw call.
 */
export class TireTracks {
  readonly mesh: Mesh;
  readonly buffer: TrackBuffer;
  private readonly geo: BufferGeometry;
  private readonly styles: Partial<Record<SurfaceId, TrackStyle>>;
  private readonly uniforms = { uTime: { value: 0 } };
  private time = 0;
  private sweepAt = 0;
  // Last cross-section per wheel: left, centre, right (x, y, z) and validity.
  private readonly last = new Float32Array(4 * 9);
  private readonly lastX = new Float32Array(4);
  private readonly lastZ = new Float32Array(4);
  private readonly has = new Uint8Array(4);
  private readonly segIndex = new Uint32Array(4);
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly fadeAttr: BufferAttribute;

  constructor(
    private readonly ground: { groundHeight(x: number, z: number, yRef: number): number },
    palette: ResolvedPalette,
    capacity: number,
  ) {
    this.buffer = new TrackBuffer(capacity);
    const p = palette;
    this.styles = {
      snow: { center: p.snowShade[0], edge: p.snow[1], alpha: 0.85, edgeAlpha: 0.7, life: 120 },
      ice: { center: p.snowShade[1], edge: p.snowShade[2], alpha: 0.35, edgeAlpha: 0.5, life: 100 },
      mud: { center: p.mud[0], edge: p.mud[1], alpha: 0.85, edgeAlpha: 0.6, life: 90 },
      // Darker and sharper than the baked ruts they run in; fade over time.
      trail: { center: p.mud[0], edge: p.earth[0], alpha: 0.75, edgeAlpha: 0.55, life: 60 },
      sand: { center: p.earth[2], edge: p.sand[0], alpha: 0.55, edgeAlpha: 0.5, life: 70 },
      grass: { center: p.grass[0], edge: p.undergrowth[1], alpha: 0.55, edgeAlpha: 0.5, life: 80 },
      forest: {
        center: p.undergrowth[0],
        edge: p.forest[1],
        alpha: 0.55,
        edgeAlpha: 0.5,
        life: 80,
      },
      gravel: { center: p.rockLight[3], edge: p.scree[3], alpha: 0.5, edgeAlpha: 0.4, life: 60 },
      scree: { center: p.rockLight[3], edge: p.scree[2], alpha: 0.45, edgeAlpha: 0.4, life: 60 },
      rock: { center: p.rockLight[2], edge: p.rockLight[2], alpha: 0.12, edgeAlpha: 0.3, life: 60 },
    };
    const b = this.buffer;
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(b.pos, 3);
    this.colAttr = new BufferAttribute(b.col, 3);
    this.fadeAttr = new BufferAttribute(b.fade, 3);
    for (const a of [this.posAttr, this.colAttr, this.fadeAttr]) a.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('aFade', this.fadeAttr);
    // Static index: 4 triangles per segment (L0 L1 C0, C0 L1 C1, C0 C1 R0, R0 C1 R1).
    const idx = new Uint32Array(capacity * 12);
    for (let i = 0; i < capacity; i++) {
      const v = i * 6;
      idx.set(
        [v, v + 3, v + 1, v + 1, v + 3, v + 4, v + 1, v + 4, v + 2, v + 2, v + 4, v + 5],
        i * 12,
      );
    }
    geo.setIndex(new BufferAttribute(idx, 1));
    this.geo = geo;
    const mat = new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    mat.onBeforeCompile = (shader) => {
      applyAtmosphere(shader);
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec3 aFade;\nuniform float uTime;\nvarying float vFade;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvFade = aFade.z * (1.0 - clamp((uTime - aFade.x) / max(aFade.y, 0.001), 0.0, 1.0));',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.a *= vFade;\nif (diffuseColor.a < 0.01) discard;',
        );
    };
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'tireTracks';
  }

  /**
   * Called at the fixed rate for each wheel. `width` is the tyre width, `handbrake` and
   * `brake` the driver's inputs, (fx, fz) the car's forward direction on the ground.
   */
  step(
    dt: number,
    i: number,
    w: WheelTrackInput,
    width: number,
    fx: number,
    fz: number,
    handbrake: boolean,
    brake: number,
  ): void {
    if (i === 0) {
      this.time += dt;
      this.uniforms.uTime.value = this.time;
    }
    const style = this.styles[w.surface];
    if (!w.contact || w.inWater || !style) {
      this.has[i] = 0;
      return;
    }
    if (!this.has[i]) {
      this.cross(i, w.x, w.z, w.y, fx, fz, width);
      this.has[i] = 1;
      return;
    }
    const dx = w.x - this.lastX[i];
    const dz = w.z - this.lastZ[i];
    const len = Math.hypot(dx, dz);
    if (len < SPACING) return;
    if (len > 3) {
      // Teleport / reset: restart the strip.
      this.cross(i, w.x, w.z, w.y, fx, fz, width);
      return;
    }
    // Intensity: load, slip, braking; the handbrake marks the rear wheels hard.
    const rearLock = handbrake && i >= 2;
    let k = 0.45 + 0.3 * Math.min(1.6, w.load) + 0.6 * w.skid + 0.25 * brake;
    if (rearLock) k += 0.5;
    k = Math.min(1, k * style.alpha);
    // A spinning wheel leaves broken marks.
    this.segIndex[i]++;
    const gap = w.spin > 0.35 && this.segIndex[i] % 3 === 1;
    const wid = width * (0.85 + 0.25 * Math.min(1.5, w.load) + 0.35 * w.skid);
    const b = this.buffer;
    const s = b.alloc();
    const o = s * V;
    // Start of the segment = previous cross-section.
    const L = this.last;
    const lo = i * 9;
    for (let c = 0; c < 9; c++) b.pos[o + c] = L[lo + c];
    this.cross(i, w.x, w.z, w.y, dx / len, dz / len, wid);
    for (let c = 0; c < 9; c++) b.pos[o + 9 + c] = L[lo + c];
    const dim = rearLock ? 0.8 : 1;
    for (let v = 0; v < 6; v++) {
      const centre = v === 1 || v === 4;
      const col = centre ? style.center : style.edge;
      b.col[o + v * 3] = col.r * dim;
      b.col[o + v * 3 + 1] = col.g * dim;
      b.col[o + v * 3 + 2] = col.b * dim;
      b.fade[o + v * 3] = this.time;
      b.fade[o + v * 3 + 1] = style.life;
      b.fade[o + v * 3 + 2] = gap ? 0 : centre ? k : k * (rearLock ? 0.6 : style.edgeAlpha);
    }
    b.meta(s, w.x, w.z, this.time + style.life);
  }

  /** Samples the ground across the tyre at (x, z) and stores it as the wheel's last section. */
  private cross(
    i: number,
    x: number,
    z: number,
    y: number,
    fx: number,
    fz: number,
    width: number,
  ): void {
    const nx = -fz * width * 0.5;
    const nz = fx * width * 0.5;
    const L = this.last;
    const o = i * 9;
    const lift = 0.035;
    const put = (k: number, px: number, pz: number): void => {
      L[o + k] = px;
      L[o + k + 1] = this.ground.groundHeight(px, pz, y + 1) + lift;
      L[o + k + 2] = pz;
    };
    put(0, x - nx, z - nz);
    put(3, x, z);
    put(6, x + nx, z + nz);
    this.lastX[i] = x;
    this.lastZ[i] = z;
  }

  /** Per frame: expiry and distance culling (twice a second), then upload new segments. */
  update(x: number, z: number): void {
    const b = this.buffer;
    if (this.time > this.sweepAt) {
      this.sweepAt = this.time + 0.5;
      b.sweep(this.time, x, z, 400);
    }
    if (b.dirtyMin < 0) return;
    const start = b.dirtyMin * V;
    const count = (b.dirtyMax - b.dirtyMin + 1) * V;
    for (const a of [this.posAttr, this.colAttr, this.fadeAttr]) {
      a.clearUpdateRanges();
      a.addUpdateRange(start, count);
      a.needsUpdate = true;
    }
    b.dirtyMin = b.dirtyMax = -1;
  }

  clear(): void {
    this.buffer.clear();
    this.has.fill(0);
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
