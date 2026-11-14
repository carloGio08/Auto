import {
  AdditiveBlending,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { Rng } from '../math/rng';

const m = new Matrix4();
const p = new Vector3();
const s = new Vector3();
const q = new Quaternion();

/**
 * Thin triangular prisms streaming past the camera at high speed or with nitro. One instanced
 * draw call attached to the camera; no textures.
 */
export class SpeedLines {
  readonly mesh: InstancedMesh;
  private readonly count: number;
  private readonly seeds: { angle: number; radius: number; z: number; speed: number }[] = [];
  private readonly material: MeshBasicMaterial;

  constructor(count = 48) {
    this.count = count;
    const rng = new Rng(8);
    for (let i = 0; i < count; i++) {
      this.seeds.push({
        angle: rng.range(0, Math.PI * 2),
        radius: rng.range(2.4, 5.2),
        z: rng.range(-30, -2),
        speed: rng.range(0.8, 1.4),
      });
    }
    const geo = new CylinderGeometry(0.018, 0.018, 1, 3, 1);
    geo.rotateX(Math.PI / 2);
    this.material = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new InstancedMesh(geo, this.material, count);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }

  attach(camera: PerspectiveCamera): void {
    camera.add(this.mesh);
  }

  update(dt: number, intensity: number, speed: number): void {
    this.material.opacity = Math.min(0.4, intensity * 0.4);
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;
    const len = 1.5 + speed * 0.08;
    for (let i = 0; i < this.count; i++) {
      const sd = this.seeds[i];
      sd.z += speed * sd.speed * dt * 1.4;
      if (sd.z > 0) sd.z -= 32;
      p.set(Math.cos(sd.angle) * sd.radius, Math.sin(sd.angle) * sd.radius * 0.6, sd.z - len / 2);
      s.set(1, 1, len);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
