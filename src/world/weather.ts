import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type Color,
} from 'three';
import { Rng } from '../math/rng';

const m = new Matrix4();
const p = new Vector3();
const s = new Vector3();
const q = new Quaternion();
const axis = new Vector3(0.3, 1, 0.2).normalize();

/** Falling snow: tiny tumbling octahedra in a box that follows the camera (one draw call). */
export class Snowfall {
  readonly mesh: InstancedMesh;
  private readonly positions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly box = 60;
  private readonly height = 40;

  constructor(
    count: number,
    color: Color,
    private readonly wind = 2,
  ) {
    const rng = new Rng(4);
    this.positions = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = rng.range(-this.box, this.box);
      this.positions[i * 3 + 1] = rng.range(0, this.height);
      this.positions[i * 3 + 2] = rng.range(-this.box, this.box);
      this.speeds[i] = rng.range(2, 4.5);
    }
    this.mesh = new InstancedMesh(
      new OctahedronGeometry(0.09, 0),
      new MeshLambertMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        flatShading: true,
      }),
      count,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
  }

  update(dt: number, camera: Vector3, time: number): void {
    // World-space flakes wrapped around the camera so they stream past when driving.
    const pos = this.positions;
    const n = this.speeds.length;
    const b = this.box;
    const sway = Math.sin(time * 0.7) * this.wind;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      pos[k + 1] -= this.speeds[i] * dt;
      pos[k] += (sway + Math.sin(time + i) * 0.4) * dt;
      const dx = pos[k] - camera.x;
      const dy = pos[k + 1] - camera.y;
      const dz = pos[k + 2] - camera.z;
      if (dx > b) pos[k] -= 2 * b;
      else if (dx < -b) pos[k] += 2 * b;
      if (dz > b) pos[k + 2] -= 2 * b;
      else if (dz < -b) pos[k + 2] += 2 * b;
      if (dy < -15) pos[k + 1] += this.height;
      else if (dy > this.height - 15) pos[k + 1] -= this.height;
      p.set(pos[k], pos[k + 1], pos[k + 2]);
      q.setFromAxisAngle(axis, time * 2 + i);
      s.setScalar(0.7 + (i % 5) * 0.15);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
