import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cars } from '../src/data/cars';
import { VehiclePhysics, type DriveInput, type GroundProvider } from '../src/vehicle/physics';
import type { GroundSample } from '../src/terrain/terrain';

/** Flat dirt plane: isolates the car's handling from the terrain. */
const flat: GroundProvider = {
  sample(_x, _z, _y, out: GroundSample) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.surface = 'dirt';
    out.onRoad = true;
    out.onBridge = false;
    out.s = 0;
    out.lateral = 0;
    return out;
  },
  groundHeight: () => 0,
  normal: (_x, _z, out: Vector3) => out.set(0, 1, 0),
  waterLevel: () => -100,
};
const dt = 1 / 120;
const f = new Vector3();
const u = new Vector3();
const l = new Vector3();
const slip = (car: VehiclePhysics): number => {
  car.axes(f, u, l);
  return Math.abs(Math.atan2(car.velocity.dot(l), car.velocity.dot(f)));
};
const fresh = (def: (typeof cars)[number], speed: number): VehiclePhysics => {
  const car = new VehiclePhysics(structuredClone(def.physics));
  car.reset(0, 0.6, 0, 0);
  car.velocity.set(0, 0, speed);
  return car;
};

describe.each(cars.map((c) => [c.id, c] as const))('handling: %s', (_id, def) => {
  it('accelerates to 100 km/h in under 6 s', () => {
    const car = fresh(def, 0);
    const input: DriveInput = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
    let t = 0;
    while (car.speed < 27.8 && t < 10) {
      car.step(dt, input, flat);
      t += dt;
    }
    expect(t).toBeLessThan(6);
  });

  it('brakes from 90 km/h in under 45 m', () => {
    const car = fresh(def, 25);
    for (let i = 0; i < 60; i++)
      car.step(dt, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }, flat);
    const z0 = car.position.z;
    let t = 0;
    while (car.forwardSpeed > 1 && t < 8) {
      car.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false }, flat);
      t += dt;
    }
    expect(car.position.z - z0).toBeLessThan(45);
  });

  it('corners with arcade grip (> 10 m/s²)', () => {
    const car = fresh(def, 20);
    let lat = 0;
    for (let i = 0; i < 360; i++) {
      car.step(dt, { throttle: 0.35, brake: 0, steer: 1, handbrake: false, nitro: false }, flat);
      lat = Math.max(lat, Math.abs(car.angularVelocity.y) * car.speed);
    }
    expect(lat).toBeGreaterThan(10);
  });

  it('drifts on a handbrake flick and recovers without spinning', () => {
    const car = fresh(def, 22);
    let maxSlip = 0;
    for (let i = 0; i < 60; i++) {
      car.step(dt, { throttle: 0.6, brake: 0, steer: 0.6, handbrake: true, nitro: false }, flat);
      maxSlip = Math.max(maxSlip, slip(car));
    }
    expect(maxSlip).toBeGreaterThan(0.25);
    let spun = false;
    for (let i = 0; i < 240; i++) {
      car.step(dt, { throttle: 0.8, brake: 0, steer: -0.3, handbrake: false, nitro: false }, flat);
      if (slip(car) > 1.6) spun = true;
    }
    expect(spun).toBe(false);
  });
});
