import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { config } from '../config';
import type { ResolvedPalette } from '../data/palette';
import type { GroundProvider } from '../vehicle/physics';
import { PropGeometry } from './propGeometry';

/** Debris shapes: a young tree top, a medium tree top, a trunk log. */
export type DebrisShape = 0 | 1 | 2;

interface Piece {
  active: boolean;
  shape: DebrisShape;
  slot: number;
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  ang: Vector3;
  /** Half length along the local Y axis and radius (m, already scaled). */
  half: number;
  radius: number;
  mass: number;
  inertia: number;
  scale: number;
  /** Geometry offset so the body centre sits at the middle of the shape. */
  offset: number;
  age: number;
  still: number;
  /** Horizontal direction the piece prefers to fall towards (tops topple, never balance). */
  fallX: number;
  fallZ: number;
}

const SHAPES: { half: number; radius: number; offset: number; mass: number }[] = [
  { half: 1.5, radius: 0.9, offset: 1.6, mass: 90 },
  { half: 3.0, radius: 1.6, offset: 3.2, mass: 380 },
  { half: 1.2, radius: 0.28, offset: 0, mass: 160 },
];

const m = new Matrix4();
const off = new Matrix4();
const sv = new Vector3();
const axis = new Vector3();
const end = new Vector3();
const r = new Vector3();
const vp = new Vector3();
const n = new Vector3();
const t = new Vector3();
const tmp = new Vector3();
const dq = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * Pooled rigid pieces of broken trees (≤ config.world.debrisMax). Each piece is a rod with
 * gravity, ground contact at both ends (impulses with friction, so tops topple and roll),
 * a light shove from the jeep, sleeping when still and a shrink-out after the lifetime.
 */
export class TreeDebris {
  private readonly meshes: InstancedMesh[] = [];
  private readonly pieces: Piece[] = [];
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly geos: BufferGeometry[];
  private readonly slotsUsed: number[] = [0, 0, 0];

  constructor(
    parent: Object3D,
    palette: ResolvedPalette,
    shadows: boolean,
    private readonly max: number = config.world.debrisMax,
  ) {
    const g = new PropGeometry(palette);
    this.geos = [g.pine('young', 1), g.pine('medium', 2), g.log()];
    for (let i = 0; i < 3; i++) {
      const mesh = new InstancedMesh(this.geos[i], this.material, max);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = shadows;
      mesh.frustumCulled = false;
      mesh.name = `debris:${i}`;
      parent.add(mesh);
      this.meshes.push(mesh);
    }
  }

  get count(): number {
    let c = 0;
    for (const p of this.pieces) if (p.active) c++;
    return c;
  }

  /**
   * Throws a piece. `dirX/dirZ` is the jeep's travel direction (tops fall that way).
   * Recycles the oldest piece when the pool is full.
   */
  spawn(
    shape: DebrisShape,
    x: number,
    y: number,
    z: number,
    scale: number,
    vx: number,
    vy: number,
    vz: number,
    dirX: number,
    dirZ: number,
    spin: number,
  ): void {
    let p = this.pieces.find((q) => !q.active);
    if (!p && this.pieces.length < this.max) {
      p = {
        active: false,
        shape: 0,
        slot: -1,
        pos: new Vector3(),
        vel: new Vector3(),
        quat: new Quaternion(),
        ang: new Vector3(),
        half: 1,
        radius: 0.3,
        mass: 1,
        inertia: 1,
        scale: 1,
        offset: 0,
        age: 0,
        still: 0,
        fallX: 0,
        fallZ: 1,
      };
      this.pieces.push(p);
    }
    if (!p) {
      p = this.pieces.reduce((a, b) => (b.age > a.age ? b : a));
      p.active = false;
    }
    const s = SHAPES[shape];
    p.active = true;
    p.shape = shape;
    p.scale = scale;
    p.half = s.half * scale;
    p.radius = s.radius * scale;
    p.offset = s.offset;
    p.mass = s.mass * scale * scale * scale;
    // Rod inertia about a perpendicular axis (+ a bit for the crown).
    p.inertia = p.mass * ((4 * p.half * p.half) / 12 + (p.radius * p.radius) / 4);
    p.pos.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.age = 0;
    p.still = 0;
    p.fallX = dirX;
    p.fallZ = dirZ;
    if (shape === 2) {
      // Logs fly sideways, tumbling end over end.
      p.quat.setFromAxisAngle(axis.set(dirZ, 0, -dirX).normalize(), Math.PI / 2 - 0.3);
      p.ang
        .set(dirZ, 0, -dirX)
        .multiplyScalar(spin)
        .add(tmp.set(0, (Math.random() - 0.5) * 4, 0));
    } else {
      p.quat.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
      // ω = up × dir tilts the top towards the travel direction: the tree falls forward.
      p.ang.copy(tmp.crossVectors(UP, axis.set(dirX, 0, dirZ)).multiplyScalar(spin));
    }
  }

  step(dt: number, ground: GroundProvider, carPos: Vector3, carVel: Vector3): void {
    const g = config.physics.gravity;
    for (const p of this.pieces) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age > config.world.debrisLifetime + 1.5) {
        p.active = false;
        continue;
      }
      // The jeep shoves pieces it drives through.
      const dxc = p.pos.x - carPos.x;
      const dzc = p.pos.z - carPos.z;
      const reach = p.radius + 1.6;
      if (dxc * dxc + dzc * dzc < reach * reach && Math.abs(p.pos.y - carPos.y) < p.half + 1.5) {
        tmp.copy(carVel).sub(p.vel);
        if (tmp.lengthSq() > 4) {
          p.vel.addScaledVector(tmp, Math.min(1, 300 / p.mass) * 0.5);
          p.vel.y += 1;
          p.still = 0;
        }
      }
      if (p.still > 0.6) continue; // asleep
      p.vel.y -= g * dt;
      p.vel.multiplyScalar(1 / (1 + 0.05 * dt));
      p.ang.multiplyScalar(1 / (1 + 0.4 * dt));
      p.pos.addScaledVector(p.vel, dt);
      const w = p.ang.length();
      if (w > 1e-5) {
        dq.setFromAxisAngle(axis.copy(p.ang).multiplyScalar(1 / w), w * dt);
        p.quat.premultiply(dq).normalize();
      }
      // Ground contact at both ends of the rod (and the middle for short pieces).
      axis.set(0, 1, 0).applyQuaternion(p.quat);
      let baseContact = false;
      for (let k = -1; k <= 1; k++) {
        end.copy(p.pos).addScaledVector(axis, p.half * k);
        const gy = ground.groundHeight(end.x, end.z, end.y + 3);
        const pen = gy + p.radius * 0.35 - end.y;
        if (pen <= 0) continue;
        if (k === -1) baseContact = true;
        ground.normal(end.x, end.z, n, end.y + 3);
        r.copy(end).sub(p.pos);
        vp.crossVectors(p.ang, r).add(p.vel);
        const vn = vp.dot(n);
        p.pos.addScaledVector(n, pen * 0.5);
        if (vn >= 0) continue;
        const rn = tmp.crossVectors(r, n);
        const k1 = 1 / p.mass + rn.lengthSq() / p.inertia;
        const jn = (-(1 + 0.15) * vn) / k1;
        p.vel.addScaledVector(n, jn / p.mass);
        p.ang.addScaledVector(rn, jn / p.inertia);
        // Friction.
        vp.crossVectors(p.ang, r).add(p.vel);
        t.copy(vp).addScaledVector(n, -vp.dot(n));
        const vt = t.length();
        if (vt > 1e-4) {
          t.multiplyScalar(1 / vt);
          const rt = tmp.crossVectors(r, t);
          const k2 = 1 / p.mass + rt.lengthSq() / p.inertia;
          const jt = Math.min(vt / k2, 0.6 * jn);
          p.vel.addScaledVector(t, -jt / p.mass);
          p.ang.addScaledVector(rt, -jt / p.inertia);
        }
      }
      // A top standing on its base topples like a rod pivoting at the base: α = 3g·sinθ / 2L,
      // with a minimum lean so it never balances upright.
      if (baseContact && axis.y > 0.35) {
        let lx = axis.x;
        let lz = axis.z;
        let l = Math.hypot(lx, lz);
        if (l < 0.15) {
          lx = lx * 0.3 + p.fallX * 0.15;
          lz = lz * 0.3 + p.fallZ * 0.15;
          l = Math.hypot(lx, lz) || 1;
        }
        const alpha = ((3 * g) / (4 * p.half)) * Math.max(0.15, l);
        // Rotation axis = up × lean.
        p.ang.x += (lz / l) * alpha * dt;
        p.ang.z += (-lx / l) * alpha * dt;
        p.still = 0;
      }
      if (p.vel.lengthSq() < 0.09 && p.ang.lengthSq() < 0.09) p.still += dt;
      else p.still = 0;
    }
  }

  /** Writes instance matrices (call once per rendered frame). */
  sync(): void {
    this.slotsUsed.fill(0);
    const life = config.world.debrisLifetime;
    for (const p of this.pieces) {
      if (!p.active) continue;
      const mesh = this.meshes[p.shape];
      const slot = this.slotsUsed[p.shape]++;
      const fade = p.age > life ? Math.max(0, 1 - (p.age - life) / 1.5) : 1;
      off.makeTranslation(0, -p.offset, 0);
      m.compose(p.pos, p.quat, sv.setScalar(p.scale * fade)).multiply(off);
      mesh.setMatrixAt(slot, m);
    }
    for (let i = 0; i < 3; i++) {
      this.meshes[i].count = this.slotsUsed[i];
      this.meshes[i].instanceMatrix.needsUpdate = true;
    }
  }

  setShadows(on: boolean): void {
    for (const mesh of this.meshes) mesh.castShadow = on;
  }

  clear(): void {
    for (const p of this.pieces) p.active = false;
    this.sync();
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.removeFromParent();
    this.geos.forEach((g) => g.dispose());
    this.material.dispose();
  }
}
