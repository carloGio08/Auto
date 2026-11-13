import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  type PerspectiveCamera,
} from 'three';
import { Rng } from '../math/rng';

/** Streaks flying past the camera at high speed or with nitro. Attached to the camera. */
export class SpeedLines {
  readonly lines: LineSegments;
  private readonly count = 60;
  private readonly data: Float32Array;
  private readonly seeds: { angle: number; radius: number; z: number; speed: number }[] = [];
  private readonly material: LineBasicMaterial;

  constructor() {
    const rng = new Rng(8);
    this.data = new Float32Array(this.count * 6);
    for (let i = 0; i < this.count; i++) {
      this.seeds.push({
        angle: rng.range(0, Math.PI * 2),
        radius: rng.range(2.2, 5),
        z: rng.range(-30, -2),
        speed: rng.range(0.8, 1.4),
      });
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.data, 3));
    this.material = new LineBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.lines = new LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
  }

  attach(camera: PerspectiveCamera): void {
    camera.add(this.lines);
  }

  update(dt: number, intensity: number, speed: number): void {
    this.material.opacity = Math.min(0.35, intensity * 0.35);
    this.lines.visible = intensity > 0.02;
    if (!this.lines.visible) return;
    const len = 1.5 + speed * 0.08;
    for (let i = 0; i < this.count; i++) {
      const s = this.seeds[i];
      s.z += speed * s.speed * dt * 1.4;
      if (s.z > 0) s.z -= 32;
      const x = Math.cos(s.angle) * s.radius;
      const y = Math.sin(s.angle) * s.radius * 0.6;
      const k = i * 6;
      this.data[k] = x;
      this.data[k + 1] = y;
      this.data[k + 2] = s.z;
      this.data[k + 3] = x;
      this.data[k + 4] = y;
      this.data[k + 5] = s.z - len;
    }
    (this.lines.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
    this.lines.removeFromParent();
  }
}
