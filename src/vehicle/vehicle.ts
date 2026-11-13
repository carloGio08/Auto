import { Quaternion, Vector3 } from 'three';
import type { CarDef, CarPhysicsDef, UpgradeDef, UpgradeId } from '../data/types';
import { surfaces } from '../data/surfaces';
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { GroundProvider, DriveInput } from './physics';
import { VehiclePhysics } from './physics';
import { CarModel } from './model';
import { Telemetry } from './telemetry';
import type { EngineSound } from '../audio/engine';
import type { ContactReport } from '../world/colliders';

/** Returns a copy of the car physics with upgrade levels applied. */
export function applyUpgrades(
  car: CarDef,
  upgrades: UpgradeDef[],
  levels: Partial<Record<UpgradeId, number>>,
): CarPhysicsDef {
  const p = structuredClone(car.physics);
  for (const u of upgrades) {
    const level = levels[u.id] ?? 0;
    if (level > 0) u.apply(p, level);
  }
  return p;
}

const pos = new Vector3();
const quat = new Quaternion();

/** A drivable car: physics body + visual model + telemetry + engine sound. */
export class Vehicle {
  readonly physics: VehiclePhysics;
  readonly model: CarModel;
  readonly telemetry: Telemetry;
  engine: EngineSound | null = null;
  /** Interpolated render transform. */
  readonly renderPosition = new Vector3();
  readonly renderQuaternion = new Quaternion();

  constructor(
    readonly def: CarDef,
    physicsDef: CarPhysicsDef,
    color: string,
    events: EventBus<GameEvents>,
  ) {
    this.physics = new VehiclePhysics(physicsDef);
    this.model = new CarModel(def, color);
    this.telemetry = new Telemetry(this.physics, events);
  }

  step(
    dt: number,
    input: DriveInput,
    ground: GroundProvider,
    contacts: () => ContactReport | null,
  ): void {
    this.physics.step(dt, input, ground);
    const report = contacts();
    this.telemetry.step(dt, report);
  }

  /** Updates the visual model with interpolation factor alpha. */
  sync(alpha: number, ground: GroundProvider, time: number, braking: boolean): void {
    const ph = this.physics;
    pos.lerpVectors(ph.prevPosition, ph.position, alpha);
    quat.slerpQuaternions(ph.prevQuaternion, ph.quaternion, alpha);
    this.renderPosition.copy(pos);
    this.renderQuaternion.copy(quat);
    const root = this.model.root;
    root.position.copy(pos);
    root.quaternion.copy(quat);
    const d = ph.def;
    const steer = ph.prevSteer + (ph.steerAngle - ph.prevSteer) * alpha;
    for (let i = 0; i < 4; i++) {
      const w = ph.wheels[i];
      const vis = this.model.wheels[i];
      const comp = Math.min(
        w.prevCompression + (w.compression - w.prevCompression) * alpha,
        d.suspension.maxTravel + 0.05,
      );
      vis.pivot.position.set(w.local.x, w.local.y - (d.suspension.restLength - comp), w.local.z);
      vis.pivot.rotation.y = w.front ? -steer : 0;
      vis.spinner.rotation.x = w.prevSpin + (w.spin - w.prevSpin) * alpha;
    }
    // Blob shadow on the ground below the car.
    const gy = ground.groundHeight(pos.x, pos.z, pos.y + 1);
    const height = pos.y - gy;
    const shadow = this.model.shadow;
    shadow.position.set(pos.x, gy + 0.08, pos.z);
    shadow.rotation.y = Math.atan2(
      2 * (quat.w * quat.y + quat.x * quat.z),
      1 - 2 * (quat.y * quat.y + quat.x * quat.x),
    );
    const mat = shadow.material as { opacity: number };
    mat.opacity = Math.max(0, 0.75 - height * 0.12);
    this.model.setBraking(braking);
    this.model.setNitro(ph.nitroActive, time);
  }

  /** Feeds the engine sound with the current physics state. */
  updateAudio(): void {
    if (!this.engine) return;
    const ph = this.physics;
    let skid = 0;
    let rough = 0;
    let rolling = 0;
    for (const w of ph.wheels) {
      if (!w.contact) continue;
      rolling += 0.25;
      skid = Math.max(skid, w.skid);
      rough += surfaces[w.surface].roughness * 0.25;
    }
    this.engine.update(
      ph.rpm,
      ph.engineLoad,
      ph.speed,
      skid,
      rough / Math.max(rolling, 0.25),
      rolling,
      ph.nitroActive,
    );
  }

  dispose(): void {
    this.model.dispose();
  }
}
