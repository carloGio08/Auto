import type { BufferGeometry } from 'three';
import {
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';

/** Low-poly shapes available to particles. */
export type ShardShape =
  'tetra' | 'octa' | 'icosa' | 'shard' | 'diamond' | 'prism' | 'leaf' | 'ring';

/** How a family of particles moves and looks. Data only (see shardKinds.ts). */
export interface ShardKind {
  shape: ShardShape;
  /** Unlit, full-bright colour (sparks, nitro, pickups). */
  glow?: boolean;
  /** Downward acceleration (m/s²); negative rises (steam, dust plumes). */
  gravity: number;
  /** Linear drag per second. */
  drag: number;
  size: [number, number];
  life: [number, number];
  /** Max spin rate (rad/s). */
  spin: number;
  /** Scale multiplier reached at the end of life (rings expand, dust puffs grow). */
  grow: number;
  /** Bounce off the ground plane given at emission (fraction of vertical speed kept). */
  bounce?: number;
}

function shapeGeometry(shape: ShardShape): BufferGeometry {
  switch (shape) {
    case 'tetra':
      return new TetrahedronGeometry(1, 0);
    case 'octa':
      return new OctahedronGeometry(1, 0);
    case 'icosa':
      return new IcosahedronGeometry(1, 0);
    case 'shard': {
      const g = new TetrahedronGeometry(1, 0);
      g.scale(0.45, 1.4, 0.3);
      return g;
    }
    case 'diamond': {
      const g = new OctahedronGeometry(1, 0);
      g.scale(0.4, 1.6, 0.4);
      return g;
    }
    case 'prism': {
      const g = new CylinderGeometry(1, 1, 1, 3, 1);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'leaf': {
      const g = new OctahedronGeometry(1, 0);
      g.scale(1, 0.12, 0.6);
      return g;
    }
    case 'ring': {
      const g = new TorusGeometry(1, 0.07, 3, 8);
      g.rotateX(Math.PI / 2);
      return g;
    }
  }
}

const m4 = new Matrix4();
const q = new Quaternion();
const axis = new Vector3();
const pos = new Vector3();
const scl = new Vector3();
const white = new Color(1, 1, 1);

/** One instanced draw call for one shape + material. Active instances are kept packed. */
class ShardPool {
  readonly mesh: InstancedMesh;
  private readonly cap: number;
  private n = 0;
  private cursor = 0;
  private readonly f: Float32Array;
  private readonly kinds: (ShardKind | null)[];
  private readonly colors: Float32Array;
  /** Floats per particle in `f`. */
  private static readonly S = 16;

  constructor(shape: ShardShape, glow: boolean, capacity: number) {
    this.cap = Math.max(8, capacity);
    const material: Material = glow
      ? new MeshBasicMaterial({ toneMapped: false })
      : new MeshLambertMaterial({ flatShading: true });
    this.mesh = new InstancedMesh(shapeGeometry(shape), material, this.cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.colors = new Float32Array(this.cap * 3).fill(1);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = `shards:${shape}${glow ? ':glow' : ''}`;
    this.f = new Float32Array(this.cap * ShardPool.S);
    this.kinds = new Array<ShardKind | null>(this.cap).fill(null);
  }

  get count(): number {
    return this.n;
  }

  emit(
    k: ShardKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: Color,
    sizeMul: number,
    floor: number,
  ): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else i = this.cursor = (this.cursor + 1) % this.cap; // full: recycle a slot
    const o = i * ShardPool.S;
    const f = this.f;
    const r = Math.random;
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = z;
    f[o + 3] = vx;
    f[o + 4] = vy;
    f[o + 5] = vz;
    // Random spin axis * rate, and initial angle.
    let ax = r() - 0.5;
    let ay = r() - 0.5;
    let az = r() - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    f[o + 6] = ax;
    f[o + 7] = ay;
    f[o + 8] = az;
    f[o + 9] = (r() * 2 - 1) * k.spin;
    f[o + 10] = r() * Math.PI * 2;
    f[o + 11] = (k.size[0] + r() * (k.size[1] - k.size[0])) * sizeMul;
    f[o + 12] = 0; // age
    f[o + 13] = k.life[0] + r() * (k.life[1] - k.life[0]);
    f[o + 14] = floor;
    this.kinds[i] = k;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
  }

  update(dt: number): void {
    const f = this.f;
    const S = ShardPool.S;
    let i = 0;
    while (i < this.n) {
      const o = i * S;
      const k = this.kinds[i]!;
      const age = (f[o + 12] += dt);
      const life = f[o + 13];
      if (age >= life) {
        this.removeAt(i);
        continue;
      }
      const drag = 1 / (1 + k.drag * dt);
      f[o + 3] *= drag;
      f[o + 4] = (f[o + 4] - k.gravity * dt) * drag;
      f[o + 5] *= drag;
      f[o] += f[o + 3] * dt;
      f[o + 1] += f[o + 4] * dt;
      f[o + 2] += f[o + 5] * dt;
      // Simple ground plane at the emission height minus a margin.
      if (k.bounce !== undefined && f[o + 1] < f[o + 14]) {
        f[o + 1] = f[o + 14];
        f[o + 4] = -f[o + 4] * k.bounce;
        f[o + 3] *= 0.6;
        f[o + 5] *= 0.6;
        f[o + 9] *= 0.5;
      }
      f[o + 10] += f[o + 9] * dt;
      const t = age / life;
      // Pop in, hold, shrink out (no transparency: no sorting, no overdraw).
      const fadeIn = t < 0.08 ? t / 0.08 : 1;
      const fadeOut = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const grow = 1 + (k.grow - 1) * t;
      const s = f[o + 11] * fadeIn * fadeOut * grow;
      pos.set(f[o], f[o + 1], f[o + 2]);
      if (k.shape === 'ring') {
        q.identity();
        scl.set(f[o + 11] * grow, f[o + 11] * fadeOut * 1.5, f[o + 11] * grow);
      } else if (k.shape === 'prism') {
        // Stretched along the velocity (spark/speed streaks).
        axis.set(f[o + 3], f[o + 4], f[o + 5]);
        const v = axis.length();
        if (v > 1e-3) q.setFromUnitVectors(Z_AXIS, axis.multiplyScalar(1 / v));
        else q.identity();
        scl.set(s * 0.25, s * 0.25, s * (1 + v * 0.05));
      } else {
        axis.set(f[o + 6], f[o + 7], f[o + 8]);
        q.setFromAxisAngle(axis, f[o + 10]);
        scl.set(s, s, s);
      }
      m4.compose(pos, q, scl);
      this.mesh.setMatrixAt(i, m4);
      i++;
    }
    this.mesh.count = this.n;
    if (this.n > 0 || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
    this.dirty = this.n > 0;
  }

  private dirty = false;

  private removeAt(i: number): void {
    const last = --this.n;
    if (i === last) return;
    const S = ShardPool.S;
    this.f.copyWithin(i * S, last * S, last * S + S);
    this.kinds[i] = this.kinds[last];
    this.colors.copyWithin(i * 3, last * 3, last * 3 + 3);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
    this.mesh.removeFromParent();
  }
}

const Z_AXIS = new Vector3(0, 0, 1);

/**
 * Instanced low-poly particle system: tetrahedra, octahedra, icosahedra, shards, diamonds,
 * prisms, leaves and octagonal rings, each with per-instance position, velocity, rotation,
 * scale and palette colour. Pools are created lazily per shape and fixed-size; emitting and
 * updating never allocate.
 */
export class ShardSystem {
  private readonly pools = new Map<string, ShardPool>();
  /** Emission multiplier from the quality preset (0.3..1). */
  density = 1;

  constructor(
    private readonly parent: Object3D,
    private readonly capacity: number,
  ) {}

  private pool(k: ShardKind): ShardPool {
    const key = k.shape + (k.glow ? '+' : '');
    let p = this.pools.get(key);
    if (!p) {
      const share = k.shape === 'ring' ? 0.06 : k.glow ? 0.18 : 0.3;
      p = new ShardPool(k.shape, !!k.glow, Math.round(this.capacity * share));
      this.pools.set(key, p);
      this.parent.add(p.mesh);
    }
    return p;
  }

  /** Emits `count` particles (scaled by density) with a random spread around a velocity. */
  burst(
    k: ShardKind,
    count: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    spread: number,
    color: Color = white,
    sizeMul = 1,
    floor = -Infinity,
  ): void {
    const p = this.pool(k);
    let n = count * this.density;
    // Fractional counts become a probability (steady streams at low quality).
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      const r = Math.random;
      p.emit(
        k,
        x,
        y,
        z,
        vx + (r() - 0.5) * 2 * spread,
        vy + (r() - 0.5) * spread,
        vz + (r() - 0.5) * 2 * spread,
        color,
        sizeMul,
        floor,
      );
      n--;
    }
  }

  /** One particle with an exact velocity. */
  one(
    k: ShardKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: Color = white,
    sizeMul = 1,
    floor = -Infinity,
  ): void {
    this.pool(k).emit(k, x, y, z, vx, vy, vz, color, sizeMul, floor);
  }

  update(dt: number): void {
    for (const p of this.pools.values()) p.update(dt);
  }

  get active(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.count;
    return n;
  }

  clear(): void {
    for (const p of this.pools.values()) p.clear();
  }

  dispose(): void {
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
  }
}
