import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  type Texture,
  type Vector3,
} from 'three';
import { Rng } from '../math/rng';

/** Falling snow particles in a box that follows the camera. */
export class Snowfall {
  readonly points: Points;
  private readonly positions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly box = 70;
  private readonly height = 40;

  constructor(
    count: number,
    sprite: Texture,
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
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        map: sprite,
        size: 0.55,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        color: '#ffffff',
      }),
    );
    this.points.frustumCulled = false;
  }

  update(dt: number, camera: Vector3, time: number): void {
    // World-space flakes wrapped around the camera so they stream past when driving.
    const p = this.positions;
    const n = this.speeds.length;
    const b = this.box;
    const sway = Math.sin(time * 0.7) * this.wind;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      p[k + 1] -= this.speeds[i] * dt;
      p[k] += (sway + Math.sin(time + i) * 0.4) * dt;
      const dx = p[k] - camera.x;
      const dy = p[k + 1] - camera.y;
      const dz = p[k + 2] - camera.z;
      if (dx > b) p[k] -= 2 * b;
      else if (dx < -b) p[k] += 2 * b;
      if (dz > b) p[k + 2] -= 2 * b;
      else if (dz < -b) p[k + 2] += 2 * b;
      if (dy < -15) p[k + 1] += this.height;
      else if (dy > this.height - 15) p[k + 1] -= this.height;
    }
    (this.points.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
    this.points.removeFromParent();
  }
}
