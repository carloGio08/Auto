import { Vector3 } from 'three';
import { config } from '../config';
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { ContactReport } from '../world/colliders';
import type { VehiclePhysics } from './physics';

const fwd = new Vector3();
const up = new Vector3();
const left = new Vector3();

/**
 * Watches the simulation and turns it into gameplay events: jumps, landings, flips, drifts,
 * near misses, crashes and splashes. Runs once per fixed step.
 */
export class Telemetry {
  airborne = false;
  private airStart = 0;
  airTime = 0;
  private pitchAcc = 0;
  private rollAcc = 0;
  private airStartPos = new Vector3();
  drifting = false;
  driftTime = 0;
  driftAngle = 0;
  private driftGrace = 0;
  topSpeed = 0;
  bestAir = 0;
  private wasSubmerged = false;
  private time = 0;
  private crashCooldown = 0;
  /** Seconds since the last crash. */
  sinceCrash = 99;

  constructor(
    private readonly car: VehiclePhysics,
    private readonly events: EventBus<GameEvents>,
  ) {}

  reset(): void {
    this.airborne = false;
    this.pitchAcc = this.rollAcc = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.wasSubmerged = false;
  }

  step(dt: number, contacts: ContactReport | null): void {
    const car = this.car;
    this.time += dt;
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    this.sinceCrash += dt;
    car.axes(fwd, up, left);
    const speed = car.speed;
    this.topSpeed = Math.max(this.topSpeed, speed);
    const flying = car.wheelsInContact === 0 && !car.chassisContact;

    // --- Air & flips ---------------------------------------------------------------------------
    if (flying) {
      if (!this.airborne) {
        this.airborne = true;
        this.airStart = this.time;
        this.pitchAcc = 0;
        this.rollAcc = 0;
        this.airStartPos.copy(car.position);
        this.events.emit('vehicle:airborne', { speed });
      }
      this.pitchAcc += car.angularVelocity.dot(left) * dt;
      this.rollAcc += car.angularVelocity.dot(fwd) * dt;
      this.airTime = this.time - this.airStart;
    } else if (this.airborne) {
      this.airborne = false;
      const airTime = this.time - this.airStart;
      this.airTime = 0;
      const onWheels = car.wheelsInContact >= 2 && up.y > 0.5;
      if (airTime >= config.gameplay.minAirTime && onWheels) {
        this.bestAir = Math.max(this.bestAir, airTime);
        const n = car.wheels[0].normal;
        const perfect =
          car.wheelsInContact >= 3 &&
          !car.chassisContact &&
          up.dot(n) > Math.cos(config.gameplay.perfectLandingAngle);
        const distance = Math.hypot(
          car.position.x - this.airStartPos.x,
          car.position.z - this.airStartPos.z,
        );
        this.events.emit('vehicle:landed', {
          airTime,
          impact: Math.max(car.lastImpact, -car.velocity.y * 0.2),
          perfect,
          distance,
        });
        const flips = Math.round(Math.abs(this.pitchAcc) / (Math.PI * 2));
        if (Math.abs(this.pitchAcc) > Math.PI * 1.6) {
          this.events.emit('vehicle:flip', {
            kind: this.pitchAcc > 0 ? 'frontflip' : 'backflip',
            count: Math.max(1, flips),
          });
        }
        const rolls = Math.round(Math.abs(this.rollAcc) / (Math.PI * 2));
        if (Math.abs(this.rollAcc) > Math.PI * 1.6)
          this.events.emit('vehicle:flip', { kind: 'barrelRoll', count: Math.max(1, rolls) });
      } else if (!onWheels && airTime > 0.3) {
        this.crash(Math.max(6, car.lastImpact));
      }
    }

    // --- Drift --------------------------------------------------------------------------------
    const grounded = car.wheelsInContact >= 2;
    const vf = car.velocity.dot(fwd);
    const vl = car.velocity.dot(left);
    const beta = Math.atan2(Math.abs(vl), Math.max(Math.abs(vf), 0.5));
    const isDrift =
      grounded &&
      speed > config.gameplay.driftMinSpeed &&
      beta > config.gameplay.driftAngle &&
      vf > 0;
    if (isDrift) {
      this.drifting = true;
      this.driftTime += dt;
      this.driftAngle = Math.max(this.driftAngle * 0.98, beta);
      this.driftGrace = 0.25;
    } else if (this.drifting) {
      this.driftGrace -= dt;
      if (this.driftGrace <= 0 || (!grounded && !flying)) {
        if (this.driftTime > 0.5)
          this.events.emit('vehicle:drift', {
            duration: this.driftTime,
            angle: this.driftAngle,
            ended: true,
          });
        this.drifting = false;
        this.driftTime = 0;
        this.driftAngle = 0;
      }
    }

    // --- Collisions -----------------------------------------------------------------------------
    if (contacts) {
      if (contacts.impact > config.gameplay.crashImpactSpeed) this.crash(contacts.impact);
      else if (contacts.impact > 2)
        this.events.emit('fx:shake', { amount: contacts.impact * 0.02 });
      if (
        contacts.nearestId >= 0 &&
        speed > config.gameplay.nearMissMinSpeed &&
        this.sinceCrash > 1
      ) {
        this.events.emit('vehicle:nearMiss', { distance: contacts.nearestClearance, speed });
      }
    }
    // Chassis slamming into the ground while upside down / on its side.
    if (car.chassisContact && up.y < 0.4 && car.lastImpact > 5) this.crash(car.lastImpact);

    // --- Water ----------------------------------------------------------------------------------
    const submerged = car.submerged > 0.2;
    if (submerged && !this.wasSubmerged) this.events.emit('vehicle:splash', { speed });
    this.wasSubmerged = submerged;
  }

  private crash(impact: number): void {
    if (this.crashCooldown > 0) return;
    this.crashCooldown = 0.8;
    this.sinceCrash = 0;
    if (this.drifting) {
      this.drifting = false;
      this.driftTime = 0;
    }
    this.events.emit('vehicle:crash', { impact });
  }
}
