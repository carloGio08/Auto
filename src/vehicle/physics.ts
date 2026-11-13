import { Quaternion, Vector3 } from 'three';
import { config } from '../config';
import { clamp, approach, lerp } from '../math/util';
import type { CarPhysicsDef, SurfaceId } from '../data/types';
import { surfaces } from '../data/surfaces';
import { createGroundSample, type GroundSample } from '../terrain/terrain';

/** What the physics needs from the world. Implemented by Terrain (+ bridge decks). */
export interface GroundProvider {
  sample(x: number, z: number, yRef: number, out: GroundSample): GroundSample;
  groundHeight(x: number, z: number, yRef: number): number;
  normal(x: number, z: number, out: Vector3, yRef?: number): Vector3;
  waterLevel(x: number, z: number): number;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  nitro: boolean;
  /** Parking brake on all wheels with full grip (countdown, menus). */
  hold?: boolean;
}

export interface Wheel {
  readonly local: Vector3;
  readonly front: boolean;
  readonly left: boolean;
  readonly driven: boolean;
  compression: number;
  prevCompression: number;
  contact: boolean;
  readonly contactPoint: Vector3;
  readonly normal: Vector3;
  load: number;
  slipAngle: number;
  /** 0..1 how much the tyre is sliding (for skid marks, smoke, sound). */
  skid: number;
  /** Wheel rotation angle (rad) and angular speed (rad/s), visual only. */
  spin: number;
  spinRate: number;
  prevSpin: number;
  surface: SurfaceId;
  onRoad: boolean;
  /** Contact velocity along the tyre's forward direction. */
  longSpeed: number;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpD = new Vector3();
const tmpQ = new Quaternion();
const fwd = new Vector3();
const up = new Vector3();
const left = new Vector3();
const force = new Vector3();
const torque = new Vector3();
const angAccAir = new Vector3();
const worldUp = new Vector3(0, 1, 0);
const impulse = new Vector3();
const contactVel = new Vector3();
const tangentVel = new Vector3();

/**
 * Rigid-body car with four raycast wheels. Body frame: +Z forward, +Y up, +X left.
 * Everything is pre-allocated: `step()` performs no allocations.
 */
export class VehiclePhysics {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  readonly angularVelocity = new Vector3();

  // Interpolation snapshot (state at the beginning of the last step).
  readonly prevPosition = new Vector3();
  readonly prevQuaternion = new Quaternion();
  prevSteer = 0;

  readonly wheels: Wheel[];
  readonly def: CarPhysicsDef;
  readonly mass: number;
  readonly invMass: number;
  private readonly inertia = new Vector3();
  private readonly invInertia = new Vector3();
  private readonly corners: Vector3[] = [];
  private readonly ground: GroundSample = createGroundSample();

  steerAngle = 0;
  /** Nitro thrust currently applied (set by the nitro system). */
  nitroActive = false;
  /** Global grip multiplier from the weather. */
  weatherGrip = 1;
  wheelsInContact = 0;
  /** True when the chassis touched the ground during the last step. */
  chassisContact = false;
  airTime = 0;
  upsideDownTime = 0;
  /** Largest impact speed seen in the last step (chassis/ground). */
  lastImpact = 0;
  submerged = 0;
  /** Engine telemetry (for audio / HUD). */
  rpm = 0;
  gear = 1;
  engineLoad = 0;
  /** True if NaN/Inf was detected; the owner should reset the car. */
  invalid = false;
  /** Total distance travelled (m). */
  odometer = 0;
  /**
   * Inputs held at take-off do not act as air control until released and pressed again:
   * holding the throttle over a jump must not nose-dive the car.
   */
  private latchThrottle = false;
  private latchBrake = false;
  private wasGrounded = true;
  /** Seed for per-surface micro bumps. */
  private bumpPhase = 0;

  constructor(def: CarPhysicsDef) {
    this.def = def;
    this.mass = def.mass;
    this.invMass = 1 / def.mass;
    const { length: l, width: w, height: h } = def.chassis;
    // Box inertia, slightly increased in yaw/pitch for stability.
    this.inertia.set(
      (def.mass / 12) * (h * h + l * l) * 1.1,
      (def.mass / 12) * (w * w + l * l) * 1.25,
      (def.mass / 12) * (w * w + h * h) * 1.2,
    );
    this.invInertia.set(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    const hw = def.trackWidth / 2;
    const hb = def.wheelbase / 2;
    const y = def.mountY;
    const driveFront = def.engine.drive !== 'rwd';
    const driveRear = def.engine.drive !== 'fwd';
    const mk = (x: number, z: number, front: boolean, isLeft: boolean): Wheel => ({
      local: new Vector3(x, y, z),
      front,
      left: isLeft,
      driven: front ? driveFront : driveRear,
      compression: 0,
      prevCompression: 0,
      contact: false,
      contactPoint: new Vector3(),
      normal: new Vector3(0, 1, 0),
      load: 0,
      slipAngle: 0,
      skid: 0,
      spin: 0,
      spinRate: 0,
      prevSpin: 0,
      surface: 'dirt',
      onRoad: false,
      longSpeed: 0,
    });
    this.wheels = [
      mk(hw, hb, true, true),
      mk(-hw, hb, true, false),
      mk(hw, -hb, false, true),
      mk(-hw, -hb, false, false),
    ];
    // Chassis contact probes: box corners, raised bottom so the wheels touch first.
    const cl = l / 2;
    const cw = w / 2;
    const bottom = y + 0.05;
    const top = bottom + h * 0.95;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        this.corners.push(new Vector3(sx * cw, bottom, sz * cl * 0.95));
        this.corners.push(new Vector3(sx * cw * 0.85, top, sz * cl * 0.6));
      }
    this.corners.push(new Vector3(0, top + 0.05, 0));
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** Signed speed along the car's forward axis. */
  get forwardSpeed(): number {
    return this.velocity.dot(fwd.set(0, 0, 1).applyQuaternion(this.quaternion));
  }

  /** Places the car at rest at a position/heading (heading = angle from +Z towards +X). */
  reset(x: number, y: number, z: number, heading: number, groundNormal?: Vector3): void {
    this.position.set(x, y, z);
    this.quaternion.setFromAxisAngle(worldUp, heading);
    if (groundNormal) {
      tmpQ.setFromUnitVectors(worldUp, groundNormal);
      this.quaternion.premultiply(tmpQ);
    }
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.steerAngle = 0;
    this.airTime = 0;
    this.upsideDownTime = 0;
    this.invalid = false;
    for (const w of this.wheels) {
      w.compression = w.prevCompression = 0;
      w.spinRate = 0;
      w.skid = 0;
    }
    this.snapshot();
  }

  snapshot(): void {
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
    this.prevSteer = this.steerAngle;
    for (const w of this.wheels) {
      w.prevCompression = w.compression;
      w.prevSpin = w.spin;
    }
  }

  /** Body axes in world space. */
  axes(outFwd: Vector3, outUp: Vector3, outLeft: Vector3): void {
    outFwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    outUp.set(0, 1, 0).applyQuaternion(this.quaternion);
    outLeft.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  /** World velocity of a point given its offset r from the centre of mass. */
  pointVelocity(r: Vector3, out: Vector3): Vector3 {
    return out.crossVectors(this.angularVelocity, r).add(this.velocity);
  }

  /** Applies an impulse J at offset r (world). */
  applyImpulse(r: Vector3, j: Vector3): void {
    this.velocity.addScaledVector(j, this.invMass);
    tmpD.crossVectors(r, j);
    this.applyAngularImpulse(tmpD);
  }

  private applyAngularImpulse(worldImpulse: Vector3): void {
    tmpQ.copy(this.quaternion).invert();
    tmpC
      .copy(worldImpulse)
      .applyQuaternion(tmpQ)
      .multiply(this.invInertia)
      .applyQuaternion(this.quaternion);
    this.angularVelocity.add(tmpC);
  }

  /** Effective inverse mass of the body along n at offset r. */
  private effectiveInvMass(r: Vector3, n: Vector3): number {
    tmpQ.copy(this.quaternion).invert();
    tmpC
      .crossVectors(r, n)
      .applyQuaternion(tmpQ)
      .multiply(this.invInertia)
      .applyQuaternion(this.quaternion);
    tmpD.crossVectors(tmpC, r);
    return this.invMass + n.dot(tmpD);
  }

  step(dt: number, input: DriveInput, world: GroundProvider): void {
    this.snapshot();
    this.lastImpact = 0;
    const def = this.def;
    const drv = config.driving;
    this.axes(fwd, up, left);
    const speed = this.velocity.length();
    const vFwd = this.velocity.dot(fwd);

    // --- Steering (speed sensitive, rate limited) -------------------------------------------
    const steerFactor = lerp(
      1,
      drv.minSteerFactor,
      clamp(Math.abs(vFwd) / drv.steerFalloffSpeed, 0, 1),
    );
    const targetSteer = input.steer * def.steering.maxAngle * steerFactor;
    const rate =
      Math.abs(targetSteer) < Math.abs(this.steerAngle) ? drv.steerReturnRate : drv.steerRate;
    this.steerAngle = approach(this.steerAngle, targetSteer, rate * dt);

    force.set(0, -config.physics.gravity * this.mass, 0);
    torque.set(0, 0, 0);
    angAccAir.set(0, 0, 0);

    // --- Suspension raycasts -----------------------------------------------------------------
    const sus = def.suspension;
    const radius = def.wheelRadius;
    const maxLen = sus.restLength + radius;
    const g = this.ground;
    this.wheelsInContact = 0;
    this.bumpPhase += speed * dt;
    for (const w of this.wheels) {
      const mount = tmpA.copy(w.local).applyQuaternion(this.quaternion).add(this.position);
      w.contact = false;
      if (up.y < 0.2) {
        w.compression = 0;
        continue;
      }
      // Ray (mount, -up) vs local tangent plane, refined twice.
      let dist = maxLen + 1;
      let hx = mount.x;
      let hz = mount.z;
      for (let it = 0; it < 2; it++) {
        world.sample(hx, hz, mount.y + 0.5, g);
        const n = g.normal;
        const denom = -(up.x * n.x + up.y * n.y + up.z * n.z);
        if (denom > -0.15) break;
        dist = ((hx - mount.x) * n.x + (g.height - mount.y) * n.y + (hz - mount.z) * n.z) / denom;
        hx = mount.x - up.x * dist;
        hz = mount.z - up.z * dist;
      }
      if (dist > maxLen || dist < -1) {
        w.compression = Math.max(0, w.compression - dt * 4);
        continue;
      }
      w.contact = true;
      this.wheelsInContact++;
      const surf = surfaces[g.surface];
      // Micro bumps per surface make dirt/gravel feel alive.
      const bump =
        surf.bumpiness *
        Math.sin(this.bumpPhase * 2.3 + w.local.x * 3 + w.local.z * 1.7) *
        Math.min(1, speed / 8);
      w.compression = maxLen - dist + bump;
      w.surface = g.surface;
      w.onRoad = g.onRoad;
      w.normal.copy(g.normal);
      w.contactPoint.set(mount.x - up.x * dist, mount.y - up.y * dist, mount.z - up.z * dist);
    }

    // --- Suspension + tyre forces ------------------------------------------------------------
    const staticLoad = (this.mass * config.physics.gravity) / 4;
    // Arcade traction assist: past ~30° of body slip the drive force is trimmed so the rear
    // tyres keep some lateral grip and big drifts stay catchable.
    const bodySlip =
      speed > 4 ? Math.abs(Math.atan2(this.velocity.dot(left), Math.abs(vFwd) + 0.5)) : 0;
    const tractionAssist = clamp(1 - (bodySlip - 0.5) * 1.3, 0.35, 1);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) {
        w.load = 0;
        w.skid = Math.max(0, w.skid - dt * 5);
        // Free wheel: spin decays, driven wheels spin up with throttle.
        w.spinRate = w.driven
          ? lerp(w.spinRate, input.throttle * 60, dt * 2)
          : w.spinRate * (1 - dt * 0.5);
        w.spin += w.spinRate * dt;
        continue;
      }
      const other = this.wheels[i ^ 1];
      const x = Math.min(w.compression, sus.maxTravel);
      const r = tmpB.copy(w.contactPoint).sub(this.position);
      const vP = this.pointVelocity(r, tmpC);
      const vUp = vP.dot(up);
      const damping = vUp < 0 ? sus.dampingBump : sus.dampingRebound;
      const arb = w.front ? sus.antiRollFront : sus.antiRollRear;
      const otherX = other.contact ? Math.min(other.compression, sus.maxTravel) : 0;
      let fz = sus.stiffness * x - damping * vUp + arb * (x - otherX);
      // Progressive bump stop in the last 15 % of travel.
      const stopStart = sus.maxTravel * 0.85;
      if (w.compression > stopStart) {
        const e = w.compression - stopStart;
        fz += sus.stiffness * 6 * e + sus.stiffness * 40 * e * e;
      }
      fz = Math.max(0, fz);
      w.load = fz;
      force.addScaledVector(up, fz);
      torque.add(tmpD.crossVectors(r, up).multiplyScalar(fz));

      // Hard stop: the wheel bottomed out, stop velocity into the ground like a rigid contact.
      if (w.compression > sus.maxTravel) {
        const n = w.normal;
        const vn = vP.dot(n);
        if (vn < 0) {
          const k = this.effectiveInvMass(r, n);
          const j = (-vn * (1 + 0.05)) / k / 2;
          this.applyImpulse(r, impulse.copy(n).multiplyScalar(j));
          this.lastImpact = Math.max(this.lastImpact, -vn);
        }
        this.position.addScaledVector(n, (w.compression - sus.maxTravel) * 0.25);
      }

      // Tyre frame on the ground plane.
      const n = w.normal;
      const cs = Math.cos(w.front ? this.steerAngle : 0);
      const sn = Math.sin(w.front ? this.steerAngle : 0);
      // Positive steer turns right (towards -left).
      const wf = tmpA.copy(fwd).multiplyScalar(cs).addScaledVector(left, -sn);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const ws = tmpD.crossVectors(n, wf); // left on the ground
      const vP2 = this.pointVelocity(r, tmpC);
      const vLong = vP2.dot(wf);
      const vLat = vP2.dot(ws);
      w.longSpeed = vLong;

      const surf = surfaces[w.surface];
      let mu = def.tires.grip * surf.grip * this.weatherGrip * drv.gripScale;
      if (!w.front) mu *= def.tires.rearBias;
      if (!w.front && input.handbrake && !input.hold) mu *= drv.handbrakeGrip;
      const fzGrip = Math.min(fz, staticLoad * 2.6);
      const maxF = mu * fzGrip;

      // Lateral: slip-angle curve.
      const slipPeak = drv.slipPeak * (9 / def.tires.corneringStiffness);
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), drv.lowSpeedCancel + 1));
      w.slipAngle = alpha;
      const a = Math.abs(alpha) / slipPeak;
      const curve = a < 1 ? a * (2 - a) : Math.max(drv.slideFactor, 1 - (a - 1) * 0.3);
      let fy = -Math.sign(alpha) * maxF * curve;

      // Longitudinal: drive, brakes, rolling resistance.
      let fx = 0;
      const wheelMass = this.mass / 4;
      const stopForce = (Math.abs(vLong) * wheelMass) / dt;
      if (w.driven) {
        const drivenCount = def.engine.drive === 'awd' ? 4 : 2;
        const engineF = Math.min(
          def.engine.power / Math.max(Math.abs(vFwd), 6),
          def.engine.maxForce,
        );
        if (input.throttle > 0) fx += (input.throttle * engineF * tractionAssist) / drivenCount;
        if (input.brake > 0 && vFwd < drv.reverseThreshold)
          fx -= (input.brake * def.engine.reverseForce) / drivenCount;
      }
      let brakeF = 0;
      if (input.brake > 0 && vFwd >= drv.reverseThreshold)
        brakeF += (input.brake * def.engine.brakeForce) / 4;
      if (input.handbrake && !w.front) brakeF += def.engine.brakeForce * 0.4;
      if (input.hold) brakeF += def.engine.brakeForce;
      brakeF += (drv.rollingResistance + surf.rollingDrag) * fz;
      if (input.throttle === 0 && input.brake === 0) brakeF += 60; // engine braking
      fx -= Math.sign(vLong) * Math.min(brakeF, stopForce);

      // Friction circle.
      const total = Math.hypot(fx, fy);
      let sliding = 0;
      if (total > maxF && total > 0) {
        const s = maxF / total;
        sliding = 1 - s;
        fx *= s;
        fy *= s;
      }
      const lateralSlide = a > 0.85 ? Math.min(1, (a - 0.85) * 1.5) : 0;
      const locked = input.handbrake && !w.front && Math.abs(vLong) > 2 ? 0.7 : 0;
      w.skid =
        Math.min(1, Math.max(lateralSlide, sliding * 2, locked)) * clamp((speed - 2) / 6, 0, 1);

      // Apply tyre forces closer to the centre of mass to limit body roll from tyre forces.
      const rApply = tmpB.copy(r).addScaledVector(up, -r.dot(up) * 0.55);
      const tf = tmpC.copy(wf).multiplyScalar(fx).addScaledVector(ws, fy);
      force.add(tf);
      torque.add(tmpA.crossVectors(rApply, tf));

      w.spinRate = locked
        ? 0
        : vLong / radius + (w.driven && sliding > 0.3 && input.throttle > 0 ? 25 * sliding : 0);
      w.spin += w.spinRate * dt;
    }

    const grounded = this.wheelsInContact > 0;
    // --- Aerodynamics, nitro -----------------------------------------------------------------
    force.addScaledVector(this.velocity, -def.aero.drag * speed);
    if (this.wheelsInContact >= 2) force.addScaledVector(up, -def.aero.downforce * speed * speed);
    if (this.nitroActive) force.addScaledVector(fwd, def.nitro.force);

    // --- Engine telemetry (for sound): automatic gearbox ------------------------------------
    const gears = config.audio.gearRatios;
    const topSpeed = 58;
    const rel = clamp(Math.abs(vFwd) / topSpeed, 0, 1);
    let gear = 1;
    while (gear < gears.length - 1 && rel > gears[gear]) gear++;
    const lo = gears[gear - 1];
    const hi = gears[gear];
    const inGear = clamp((rel - lo) / (hi - lo), 0, 1);
    const anySpin = this.wheels.some((wh) => wh.driven && wh.skid > 0.5);
    const targetRpm =
      config.audio.engineIdleRpm +
      (config.audio.engineMaxRpm - config.audio.engineIdleRpm) *
        (grounded ? 0.25 + 0.7 * inGear : input.throttle * 0.9) +
      (anySpin ? 900 : 0);
    this.rpm = lerp(this.rpm, targetRpm, dt * 8);
    this.gear = gear;
    this.engineLoad = lerp(
      this.engineLoad,
      Math.max(input.throttle, this.nitroActive ? 1 : 0),
      dt * 6,
    );

    // --- Drift assist & air control ----------------------------------------------------------
    if (grounded && input.handbrake && speed > 6 && !input.hold) {
      angAccAir.addScaledVector(up, -input.steer * drv.handbrakeYaw);
    }
    if (grounded && speed > config.gameplay.driftMinSpeed) {
      const lat = this.velocity.dot(left);
      const beta = Math.atan2(lat, Math.max(Math.abs(vFwd), 1));
      if (Math.abs(beta) > 0.15) {
        // Steering input helps rotate the car while sliding; yaw is damped to avoid spin-outs.
        angAccAir.addScaledVector(
          up,
          -input.steer * drv.driftAssist * Math.min(1, Math.abs(beta) * 2),
        );
        const yawRate = this.angularVelocity.dot(up);
        if (Math.abs(yawRate) > 2.2)
          angAccAir.addScaledVector(up, -Math.sign(yawRate) * (Math.abs(yawRate) - 2.2) * 6);
      }
    }
    if (!grounded) {
      if (this.wasGrounded) {
        this.latchThrottle = input.throttle > 0.1;
        this.latchBrake = input.brake > 0.1;
      }
      if (input.throttle < 0.1) this.latchThrottle = false;
      if (input.brake < 0.1) this.latchBrake = false;
      if (!this.chassisContact) this.airTime += dt;
      else this.airTime = 0;
      const ac = def.airControl;
      const pitchIn =
        (this.latchThrottle ? 0 : input.throttle) - (this.latchBrake ? 0 : input.brake);
      const rollIn = input.handbrake ? 0 : input.steer;
      const yawIn = input.handbrake ? -input.steer : 0;
      angAccAir.addScaledVector(left, pitchIn * drv.airPitchAccel * ac);
      angAccAir.addScaledVector(fwd, rollIn * drv.airRollAccel * ac);
      angAccAir.addScaledVector(up, yawIn * drv.airYawAccel * ac * 2);
      if (Math.abs(pitchIn) < 0.1 && Math.abs(rollIn) < 0.1) {
        // Soft self-righting: rotate "up" towards world up, damp the spin.
        tmpA.crossVectors(up, worldUp);
        angAccAir.addScaledVector(tmpA, drv.airSelfRight * 2);
        angAccAir.addScaledVector(this.angularVelocity, -0.8);
      }
    } else {
      this.airTime = 0;
    }
    this.wasGrounded = grounded;

    // Upside down on the ground → flip back after a delay.
    if (up.y < 0.25 && speed < 6) {
      this.upsideDownTime += dt;
      if (this.upsideDownTime > drv.flipBackDelay) {
        tmpA.crossVectors(up, worldUp).normalize();
        if (tmpA.lengthSq() < 0.5) tmpA.copy(fwd);
        this.angularVelocity.copy(tmpA).multiplyScalar(4.5);
        this.velocity.y = Math.max(this.velocity.y, 5);
        this.upsideDownTime = 0;
      }
    } else {
      this.upsideDownTime = Math.max(0, this.upsideDownTime - dt);
    }

    // --- Water ---------------------------------------------------------------------------------
    const water = world.waterLevel(this.position.x, this.position.z);
    const depth = water - (this.position.y - 0.4);
    this.submerged = clamp(depth / 1.2, 0, 1);
    if (this.submerged > 0) {
      force.y += this.mass * config.physics.gravity * config.physics.waterBuoyancy * this.submerged;
      force.addScaledVector(this.velocity, -this.mass * config.physics.waterDrag * this.submerged);
    }

    // --- Integrate ---------------------------------------------------------------------------
    this.velocity.addScaledVector(force, this.invMass * dt);
    tmpQ.copy(this.quaternion).invert();
    tmpA
      .copy(torque)
      .applyQuaternion(tmpQ)
      .multiply(this.invInertia)
      .applyQuaternion(this.quaternion);
    this.angularVelocity.addScaledVector(tmpA, dt).addScaledVector(angAccAir, dt);
    this.angularVelocity.multiplyScalar(1 / (1 + config.physics.angularDamping * dt));
    const maxV = config.physics.maxSpeed;
    if (this.velocity.lengthSq() > maxV * maxV) this.velocity.setLength(maxV);
    const maxW = config.physics.maxAngularSpeed;
    if (this.angularVelocity.lengthSq() > maxW * maxW) this.angularVelocity.setLength(maxW);

    this.position.addScaledVector(this.velocity, dt);
    this.odometer += speed * dt;
    const wx = this.angularVelocity.x * dt * 0.5;
    const wy = this.angularVelocity.y * dt * 0.5;
    const wz = this.angularVelocity.z * dt * 0.5;
    const q = this.quaternion;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;
    q.set(
      qx + wx * qw + wy * qz - wz * qy,
      qy + wy * qw + wz * qx - wx * qz,
      qz + wz * qw + wx * qy - wy * qx,
      qw - wx * qx - wy * qy - wz * qz,
    ).normalize();

    // --- Chassis vs ground contacts ------------------------------------------------------------
    this.resolveChassis(world);

    // --- Safety --------------------------------------------------------------------------------
    if (!this.isFinite()) this.invalid = true;
  }

  private resolveChassis(world: GroundProvider): void {
    const e = config.physics.chassisRestitution;
    const mu = config.physics.chassisFriction;
    let maxDepth = 0;
    this.chassisContact = false;
    for (const c of this.corners) {
      const p = tmpA.copy(c).applyQuaternion(this.quaternion).add(this.position);
      const h = world.groundHeight(p.x, p.z, p.y + 1.5);
      if (p.y >= h) continue;
      this.chassisContact = true;
      const n = world.normal(p.x, p.z, tmpB, p.y + 1.5);
      const depth = (h - p.y) * n.y;
      maxDepth = Math.max(maxDepth, depth);
      const r = p.sub(this.position);
      const vP = this.pointVelocity(r, contactVel);
      const vn = vP.dot(n);
      if (vn < 0) {
        // Friction impulse opposite to tangential velocity.
        const vt = tangentVel.copy(vP).addScaledVector(n, -vn);
        const vtLen = vt.length();
        const k = this.effectiveInvMass(r, n);
        const jn = (-(1 + e) * vn) / k;
        this.lastImpact = Math.max(this.lastImpact, -vn);
        const imp = impulse.copy(n).multiplyScalar(jn);
        if (vtLen > 1e-4) {
          const jt = Math.min(vtLen / k, mu * jn);
          imp.addScaledVector(vt, -jt / vtLen);
        }
        this.applyImpulse(r, imp);
      }
    }
    if (maxDepth > 0) this.position.y += Math.min(maxDepth, 0.5) * 0.8;
  }

  isFinite(): boolean {
    const p = this.position;
    const v = this.velocity;
    const w = this.angularVelocity;
    const q = this.quaternion;
    return (
      Number.isFinite(p.x + p.y + p.z) &&
      Number.isFinite(v.x + v.y + v.z) &&
      Number.isFinite(w.x + w.y + w.z) &&
      Number.isFinite(q.x + q.y + q.z + q.w)
    );
  }

  /** Total suspension load (N); useful for landing detection. */
  get totalLoad(): number {
    let s = 0;
    for (const w of this.wheels) s += w.load;
    return s;
  }
}
