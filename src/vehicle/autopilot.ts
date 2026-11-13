import { Vector3 } from 'three';
import { clamp, wrapAngle } from '../math/util';
import { createRoadPoint, type Road } from '../terrain/road';
import type { DriveInput, VehiclePhysics } from './physics';
import { surfaces } from '../data/surfaces';

const fwd = new Vector3();
const up = new Vector3();
const left = new Vector3();

/**
 * Simple road-following driver. Used by tests (stability and lap-time estimates), the e2e
 * screenshot run and the attract camera. Not meant to be a competitive AI.
 */
export class Autopilot {
  private readonly p = createRoadPoint();
  /** Lateral grip budget (m/s²) used to choose cornering speed. */
  cornering = 11;
  maxSpeed = 60;

  constructor(private readonly road: Road) {}

  drive(car: VehiclePhysics, s: number, out: DriveInput): DriveInput {
    car.axes(fwd, up, left);
    const speed = car.speed;
    const look = 7 + speed * 0.45;
    const target = this.road.pointAt(s + look, this.p);
    const dx = target.x - car.position.x;
    const dz = target.z - car.position.z;
    const desired = Math.atan2(dx, dz);
    const heading = Math.atan2(fwd.x, fwd.z);
    const err = wrapAngle(desired - heading);
    // Positive steer = right = decreasing heading.
    // No steering in the air (it would roll the car).
    out.steer = car.wheelsInContact === 0 ? 0 : clamp(-err * 2.2, -1, 1);
    // Upcoming curvature → target speed.
    let k = 0;
    for (let d = 0; d <= 30 + speed * 1.8; d += 4) {
      const i = Math.min(this.road.count - 1, Math.round((s + d) / this.road.spacing));
      k = Math.max(k, Math.abs(this.road.curvature[i]));
    }
    const grip = Math.min(
      surfaces[this.road.surfaceAt(s)].grip,
      surfaces[this.road.surfaceAt(s + 30)].grip,
    );
    const vTarget = Math.min(this.maxSpeed, Math.sqrt((this.cornering * grip) / Math.max(k, 1e-4)));
    out.throttle = speed < vTarget ? clamp((vTarget - speed) * 0.4, 0.25, 1) : 0;
    out.brake = speed > vTarget + 2 ? clamp((speed - vTarget) * 0.15, 0, 1) : 0;
    out.handbrake = false;
    out.nitro = false;
    return out;
  }
}
