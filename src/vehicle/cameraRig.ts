import { PerspectiveCamera, Vector3 } from 'three';
import { config } from '../config';
import { clamp, damp, lerp } from '../math/util';
import { CAMERA_MODES, type CameraMode, type Settings } from '../core/settings';
import type { LookState } from '../input/inputManager';
import type { Collider, CollisionWorld } from '../world/colliders';
import type { Props, TreeRef } from '../world/props';
import type { GroundProvider } from './physics';
import type { Vehicle } from './vehicle';

const fwd = new Vector3();
const up = new Vector3();
const desired = new Vector3();
const look = new Vector3();
const flatVel = new Vector3();
const flatFwd = new Vector3();
const dir = new Vector3();
const nearby: Collider[] = [];

/** Optional world access for occlusion handling. */
export interface CameraWorld {
  colliders: CollisionWorld;
  props: Props;
}

/** User-tunable camera parameters (from Settings). */
export interface CameraPrefs {
  distance: number;
  height: number;
  fov: number;
  shake: number;
}

/**
 * Third-person camera for a long downhill drive.
 *
 * - chase / wide: high, far spring-follow that tracks the direction of motion (lags in drifts,
 *   never flips in reverse), looks ahead with speed and tilts down to show the slope ahead,
 *   rising on steep descents; vertical motion is low-passed so bumps do not shake it;
 * - hood: first-person bonnet view;
 * - free look (mouse drag, right stick, one-finger drag) with auto-recentre;
 * - keeps clear of the terrain and solid props; trees between camera and jeep shrink away;
 * - dynamic FOV, adjustable shake, soft repositioning after a reset.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';
  prefs: CameraPrefs = { distance: 1, height: 1, fov: config.camera.fovBase, shake: 1 };
  world: CameraWorld | null = null;
  private readonly heading = new Vector3(0, 0, 1);
  private readonly smoothLook = new Vector3();
  private anchorY = 0;
  private lift = 0;
  private shake = 0;
  private time = 0;
  private fovBoost = 0;
  private yaw = 0;
  private pitch = 0;
  private idleLook = 10;
  /** Seconds left of the soft re-framing after a reset. */
  private recover = 0;
  private aspect: number;
  private readonly faded = new Map<TreeRef, number>();
  private readonly occluding = new Set<TreeRef>();

  constructor(aspect: number) {
    this.aspect = aspect;
    this.camera = new PerspectiveCamera(config.camera.fovBase, aspect, 0.5, 28000);
  }

  /** Copies the user's camera preferences (no allocation; safe to call every frame). */
  syncPrefs(s: Settings): void {
    this.prefs.distance = s.cameraDistance;
    this.prefs.height = s.cameraHeight;
    this.prefs.fov = s.cameraFov;
    this.prefs.shake = s.cameraShake;
  }

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount * this.prefs.shake);
  }

  /** Temporary FOV kick (nitro, boost). */
  kickFov(amount: number): void {
    this.fovBoost = Math.max(this.fovBoost, amount);
  }

  /**
   * Re-frames the jeep after a reset. Nearby targets glide into place; far jumps (deep
   * resets, first frame) cut directly.
   */
  snap(vehicle: Vehicle, ground: GroundProvider, smooth = false): void {
    fwd.set(0, 0, 1).applyQuaternion(vehicle.renderQuaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    this.heading.copy(fwd);
    this.yaw = this.pitch = 0;
    this.anchorY = vehicle.renderPosition.y;
    const far = this.camera.position.distanceTo(vehicle.renderPosition) > 120;
    if (smooth && !far) {
      this.recover = 0.9;
      return;
    }
    this.lift = 0;
    this.update(1, vehicle, ground, null, true);
  }

  update(
    dt: number,
    vehicle: Vehicle,
    ground: GroundProvider,
    lookInput: LookState | null = null,
    snap = false,
  ): void {
    this.time += dt;
    const cam = this.camera;
    const c = config.camera;
    const ph = vehicle.physics;
    const p = vehicle.renderPosition;
    const q = vehicle.renderQuaternion;
    fwd.set(0, 0, 1).applyQuaternion(q);
    up.set(0, 1, 0).applyQuaternion(q);
    const speed = ph.speed;
    const vFwd = ph.forwardSpeed;
    this.recover = Math.max(0, this.recover - dt);
    const boost = this.recover > 0 ? 2.2 : 1;

    // Free look: accumulate, then recentre after a short idle time.
    if (lookInput && (lookInput.active || lookInput.dx !== 0 || lookInput.dy !== 0)) {
      this.yaw = clamp(this.yaw + lookInput.dx, -Math.PI, Math.PI);
      this.pitch = clamp(this.pitch + lookInput.dy, -0.6, 0.9);
      this.idleLook = 0;
    } else {
      this.idleLook += dt;
      if (this.idleLook > c.lookRecenterDelay) {
        const k = damp(c.lookRecenterRate, dt);
        this.yaw = lerp(this.yaw, 0, k);
        this.pitch = lerp(this.pitch, 0, k);
      }
    }

    // Heading: the direction of travel when moving forward (drifts show the slide), the nose
    // otherwise. Reversing keeps the nose direction, so the camera never swings around.
    flatFwd.copy(fwd).setY(0);
    if (flatFwd.lengthSq() < 1e-4) flatFwd.copy(this.heading);
    flatFwd.normalize();
    flatVel.copy(ph.velocity).setY(0);
    const velWeight = vFwd > 2 ? clamp((speed - 3) / 10, 0, c.velocityFollow) : 0;
    if (flatVel.lengthSq() > 1) flatVel.normalize();
    else flatVel.copy(flatFwd);
    const target = flatFwd.multiplyScalar(1 - velWeight).addScaledVector(flatVel, velWeight);
    if (target.lengthSq() < 1e-4) target.copy(this.heading);
    target.normalize();
    this.heading.lerp(target, snap ? 1 : damp(c.chaseRotStiffness * boost, dt)).normalize();

    // Vertical anchor: low-passed so suspension bumps do not shake the view.
    if (snap) this.anchorY = p.y;
    else {
      this.anchorY = lerp(this.anchorY, p.y, damp(c.verticalStiffness * boost, dt));
      this.anchorY = clamp(this.anchorY, p.y - 1.5, p.y + 1.5);
    }

    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // View direction = heading rotated by the free-look yaw (positive yaw looks right).
    dir.set(
      this.heading.x * cy - this.heading.z * sy,
      0,
      this.heading.z * cy + this.heading.x * sy,
    );

    if (this.mode === 'hood') {
      cam.position.copy(p).addScaledVector(up, 1.45).addScaledVector(fwd, 0.6);
      // Bonnet view direction: the nose, turned by the free-look yaw around the vertical.
      const hx = fwd.x * cy - fwd.z * sy;
      const hz = fwd.z * cy + fwd.x * sy;
      look.set(
        cam.position.x + hx * 20,
        cam.position.y + fwd.y * 20 + 20 * Math.sin(this.pitch) - 1.2,
        cam.position.z + hz * 20,
      );
      cam.up
        .copy(up)
        .lerp(desired.set(0, 1, 0), 0.5)
        .normalize();
      cam.lookAt(look);
      this.lift = 0;
      this.restoreTrees(dt, true);
    } else {
      const wide = this.mode === 'wide';
      const prefs = this.prefs;
      // Grade of the terrain ahead along the heading (negative = downhill).
      const g0 = ground.groundHeight(p.x, p.z, p.y + 2);
      const aheadD = 14 + speed * 0.3;
      const ax = p.x + this.heading.x * aheadD;
      const az = p.z + this.heading.z * aheadD;
      const gA = ground.groundHeight(ax, az, p.y + 20);
      const grade = clamp((gA - g0) / aheadD, -1, 1);
      const descent = clamp(-grade, 0, 0.7);

      let dist = (wide ? c.wideDistance : c.chaseDistance) * prefs.distance + speed * 0.05;
      let height = (wide ? c.wideHeight : c.chaseHeight) * prefs.height;
      height += descent * c.descentLift * (wide ? 1.3 : 1);
      dist *= 1 - descent * 0.15;
      // Orbit for free look.
      const orbitPitch = this.pitch;
      const hd = dist * Math.cos(orbitPitch * 0.8);
      desired.set(
        p.x - dir.x * hd,
        this.anchorY + height + dist * Math.sin(orbitPitch),
        p.z - dir.z * hd,
      );

      // Terrain clearance along the sight line: lift the camera so the line from the jeep's
      // roof to the camera clears the ground.
      const fromY = this.anchorY + 1.6;
      let need = 0;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const x = p.x + (desired.x - p.x) * t;
        const z = p.z + (desired.z - p.z) * t;
        const y = fromY + (desired.y - fromY) * t;
        const gy = ground.groundHeight(x, z, y + 10);
        const clearance = i === 6 ? c.groundClearance : c.groundClearance * 0.6;
        need = Math.max(need, (gy + clearance - y) / t);
      }
      need = Math.min(need, 30);
      // Solid props (rocks, houses, posts): rise above them rather than clip through.
      if (this.world) {
        for (const col of this.world.colliders.query(desired.x, desired.z, 1.5, nearby)) {
          if (col.kind === 'tree' || col.kind === 'hazard') continue;
          const dx = desired.x - col.ax;
          const dz = desired.z - col.az;
          if (dx * dx + dz * dz < (col.radius + 1) ** 2)
            need = Math.max(need, col.yMax + 0.8 - desired.y);
        }
      }
      // Rise fast, settle slowly.
      this.lift = snap ? need : lerp(this.lift, need, damp(need > this.lift ? 14 : 2, dt));
      desired.y += this.lift;

      if (snap) cam.position.copy(desired);
      else {
        const k = damp(c.chaseStiffness * boost, dt);
        cam.position.x = lerp(cam.position.x, desired.x, k);
        cam.position.z = lerp(cam.position.z, desired.z, k);
        cam.position.y = lerp(cam.position.y, desired.y, damp(c.chaseStiffness * 1.3 * boost, dt));
        // Never below the ground, whatever the spring does.
        const gy = ground.groundHeight(cam.position.x, cam.position.z, cam.position.y + 10);
        if (cam.position.y < gy + 0.8) cam.position.y = gy + 0.8;
      }

      // Look ahead with speed, towards the ground ahead: on descents the view tilts down
      // and shows the slope in front of the jeep.
      const la = (c.chaseLookAhead + Math.min(speed * 0.35, 18)) * (wide ? 1.2 : 1);
      look.set(p.x + dir.x * la, 0, p.z + dir.z * la);
      const gL = ground.groundHeight(look.x, look.z, p.y + 30);
      look.y = lerp(this.anchorY + 1.2, gL + 1.4, 0.55) + this.pitch * 6;
      if (snap) this.smoothLook.copy(look);
      else this.smoothLook.lerp(look, damp(c.lookStiffness * boost, dt));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.smoothLook);
      this.fadeTrees(dt, p);
    }

    // Shake (scaled by the user preference).
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.x += (Math.sin(this.time * 47) + Math.sin(this.time * 83)) * s * 0.5;
      cam.position.y += Math.sin(this.time * 61) * s * 0.5;
      cam.rotation.z += Math.sin(this.time * 37) * s * 0.03;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    // Dynamic FOV; portrait screens get a wider vertical FOV.
    this.fovBoost = Math.max(0, this.fovBoost - dt * 6);
    const base = this.prefs.fov * (this.aspect < 1.2 ? 1.22 : 1);
    const fov = base + (c.fovMax - c.fovBase) * clamp(speed / c.fovSpeed, 0, 1) + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = snap ? fov : lerp(cam.fov, fov, damp(4, dt));
      cam.updateProjectionMatrix();
    }
  }

  /** Shrinks trees standing between the camera and the jeep; restores them afterwards. */
  private fadeTrees(dt: number, p: Vector3): void {
    const props = this.world?.props;
    if (!props) return;
    const cam = this.camera.position;
    const occ = this.occluding;
    occ.clear();
    const mx = (cam.x + p.x) / 2;
    const mz = (cam.z + p.z) / 2;
    const dx = p.x - cam.x;
    const dz = p.z - cam.z;
    const len2 = dx * dx + dz * dz || 1;
    const r = Math.sqrt(len2) / 2 + 4;
    props.forEachTreeNear(mx, mz, r, (t) => {
      const tt = ((t.x - cam.x) * dx + (t.z - cam.z) * dz) / len2;
      if (tt < -0.1 || tt > 0.92) return;
      const qx = cam.x + dx * tt - t.x;
      const qz = cam.z + dz * tt - t.z;
      const crown = (t.tier === 'old' ? 2.8 : t.tier === 'medium' ? 2 : 1.2) * t.scale;
      if (qx * qx + qz * qz < (crown + 0.8) ** 2) {
        occ.add(t);
        if (!this.faded.has(t)) this.faded.set(t, 1);
      }
    });
    this.restoreTrees(dt, false);
  }

  private restoreTrees(dt: number, all: boolean): void {
    const props = this.world?.props;
    if (!props || this.faded.size === 0) return;
    for (const [t, k] of this.faded) {
      const target = !all && this.occluding.has(t) ? 0.08 : 1;
      const next = target < k ? Math.max(target, k - dt * 5) : Math.min(target, k + dt * 2.5);
      props.setTreeScale(t, next);
      if (next >= 1) this.faded.delete(t);
      else this.faded.set(t, next);
    }
  }

  /**
   * Opening fly-over: from far above the massif, orbiting down onto the summit and ending
   * exactly where the chase camera starts. `t` goes 0 → 1.
   */
  intro(t: number, vehicle: Vehicle, ground: GroundProvider, centre: Vector3): void {
    const cam = this.camera;
    const p = vehicle.renderPosition;
    fwd.set(0, 0, 1).applyQuaternion(vehicle.renderQuaternion).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const e = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
    const c = config.camera;
    const behind = Math.atan2(-fwd.x, -fwd.z);
    // Start out over the descent, low, looking back up at the snowy summit; swing round
    // while closing in and finish exactly at the chase position behind the jeep.
    const a = behind + (1 - e) * Math.PI * 1.15;
    const r0 = 950;
    const r1 = c.chaseDistance * this.prefs.distance;
    const r = r0 * Math.pow(r1 / r0, e);
    const h1 = c.chaseHeight * this.prefs.height;
    const hgt = -140 + (h1 + 140) * e;
    cam.position.set(p.x + Math.sin(a) * r, p.y + hgt, p.z + Math.cos(a) * r);
    const gy = ground.groundHeight(cam.position.x, cam.position.z, cam.position.y + 50);
    cam.position.y = Math.max(cam.position.y, gy + 2 + 90 * (1 - e));
    look.set(p.x, p.y + 1.2 + 40 * (1 - e) * (1 - e), p.z);
    void centre;
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    const fov = this.prefs.fov * (this.aspect < 1.2 ? 1.22 : 1);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.heading.copy(fwd);
    this.smoothLook.copy(look);
    this.anchorY = p.y;
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
