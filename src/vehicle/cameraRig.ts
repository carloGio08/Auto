import { PerspectiveCamera, Vector3 } from 'three';
import { config } from '../config';
import { clamp, damp, lerp } from '../math/util';
import type { CameraMode } from '../core/settings';
import type { GroundProvider } from './physics';
import type { Vehicle } from './vehicle';

const fwd = new Vector3();
const up = new Vector3();
const desired = new Vector3();
const look = new Vector3();
const flatVel = new Vector3();

/** Chase / hood / high camera with spring smoothing, dynamic FOV and shake. */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';
  private readonly heading = new Vector3(0, 0, 1);
  private readonly smoothLook = new Vector3();
  private shake = 0;
  private time = 0;
  private fovBoost = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(config.camera.fovBase, aspect, 0.5, 13000);
  }

  cycle(): CameraMode {
    const order: CameraMode[] = ['chase', 'hood', 'high'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    return this.mode;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Temporary FOV kick (nitro, boost). */
  kickFov(amount: number): void {
    this.fovBoost = Math.max(this.fovBoost, amount);
  }

  /** Places the camera immediately behind the car (after resets). */
  snap(vehicle: Vehicle, ground: GroundProvider): void {
    fwd.set(0, 0, 1).applyQuaternion(vehicle.renderQuaternion);
    fwd.y = 0;
    fwd.normalize();
    this.heading.copy(fwd);
    this.update(1, vehicle, ground, true);
  }

  update(dt: number, vehicle: Vehicle, ground: GroundProvider, snap = false): void {
    this.time += dt;
    const cam = this.camera;
    const c = config.camera;
    const p = vehicle.renderPosition;
    const q = vehicle.renderQuaternion;
    fwd.set(0, 0, 1).applyQuaternion(q);
    up.set(0, 1, 0).applyQuaternion(q);
    const speed = vehicle.physics.speed;

    // Heading follows the velocity when moving (shows drifts), the nose when slow.
    flatVel.copy(vehicle.physics.velocity);
    flatVel.y = 0;
    const flatFwd = desired.copy(fwd).setY(0);
    if (flatFwd.lengthSq() < 1e-4) flatFwd.copy(this.heading);
    flatFwd.normalize();
    const velWeight = clamp((speed - 4) / 10, 0, 0.65);
    if (flatVel.lengthSq() > 1) flatVel.normalize();
    else flatVel.copy(flatFwd);
    const targetHeading = flatFwd
      .multiplyScalar(1 - velWeight)
      .addScaledVector(flatVel, velWeight)
      .normalize();
    this.heading.lerp(targetHeading, snap ? 1 : damp(c.chaseRotStiffness, dt)).normalize();

    if (this.mode === 'hood') {
      cam.position.copy(p).addScaledVector(up, 1.15).addScaledVector(fwd, 0.4);
      look.copy(p).addScaledVector(fwd, 20).addScaledVector(up, 0.8);
      cam.up.copy(up);
      cam.lookAt(look);
    } else {
      const high = this.mode === 'high';
      const dist = (high ? c.highDistance : c.chaseDistance) + speed * 0.04;
      const height = high ? c.highHeight : c.chaseHeight;
      desired.copy(p).addScaledVector(this.heading, -dist);
      desired.y += height;
      // Keep the camera above the ground.
      const gy = ground.groundHeight(desired.x, desired.z, desired.y + 5);
      if (desired.y < gy + 1.4) desired.y = gy + 1.4;
      if (snap) cam.position.copy(desired);
      else {
        const k = damp(c.chaseStiffness, dt);
        cam.position.x = lerp(cam.position.x, desired.x, k);
        cam.position.z = lerp(cam.position.z, desired.z, k);
        cam.position.y = lerp(cam.position.y, desired.y, damp(c.chaseStiffness * 1.4, dt));
      }
      look.copy(p).addScaledVector(this.heading, c.chaseLookAhead * 0.5 + speed * 0.05);
      look.y += high ? 0.5 : 1.1;
      if (snap) this.smoothLook.copy(look);
      else this.smoothLook.lerp(look, damp(12, dt));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.smoothLook);
    }

    // Shake.
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.x += (Math.sin(this.time * 47) + Math.sin(this.time * 83)) * s * 0.5;
      cam.position.y += Math.sin(this.time * 61) * s * 0.5;
      cam.rotation.z += Math.sin(this.time * 37) * s * 0.03;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    // Dynamic FOV.
    this.fovBoost = Math.max(0, this.fovBoost - dt * 6);
    const fov = lerp(c.fovBase, c.fovMax, clamp(speed / c.fovSpeed, 0, 1)) + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = lerp(cam.fov, fov, damp(4, dt));
      cam.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
