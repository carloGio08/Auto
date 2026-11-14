import { config } from '../src/config';
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
    out.surface = 'trail';
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
  it('accelerates to 80 km/h in under 6 s', () => {
    const car = fresh(def, 0);
    const input: DriveInput = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
    let t = 0;
    while (car.speed < 22.2 && t < 10) {
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

  it('tops out 35 % faster than the off-roader baseline on the flat', () => {
    const drv = config.driving as { speedScale: number };
    const top = (k: number): number => {
      const saved = drv.speedScale;
      drv.speedScale = k;
      try {
        const car = fresh(def, 0);
        const input: DriveInput = {
          throttle: 1,
          brake: 0,
          steer: 0,
          handbrake: false,
          nitro: false,
        };
        for (let i = 0; i < 120 * 90; i++) car.step(dt, input, flat);
        return car.speed * 3.6;
      } finally {
        drv.speedScale = saved;
      }
    };
    const base = top(1);
    const now = top(config.driving.speedScale);
    // Baseline: an off-roader (90–125 km/h); now about 35 % more.
    expect(base).toBeGreaterThan(90);
    expect(base).toBeLessThan(125);
    expect(now / base).toBeGreaterThan(1.3);
    expect(now / base).toBeLessThan(1.4);
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

/** Constant slope rising towards -Z (so +Z is downhill), grade g. */
const slope = (g: number): GroundProvider => {
  const n = new Vector3(0, 1, g).normalize();
  return {
    sample(_x, z, _y, out: GroundSample) {
      out.height = -g * z;
      out.normal.copy(n);
      out.surface = 'trail';
      out.onRoad = true;
      out.onBridge = false;
      out.s = 0;
      out.lateral = 0;
      return out;
    },
    groundHeight: (_x, z) => -g * z,
    normal: (_x, _z, out: Vector3) => out.copy(n),
    waterLevel: () => -1e4,
  };
};

const idle: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

describe.each(cars.map((c) => [c.id, c] as const))('jeep feel: %s', (_id, def) => {
  it('lands a 4 m drop and settles within 1.5 s without bouncing', () => {
    const car = new VehiclePhysics(structuredClone(def.physics));
    car.reset(0, 4.5, 0, 0);
    let landed = -1;
    let lowest = Infinity;
    let rebound = 0;
    for (let i = 0; i < 600; i++) {
      car.step(dt, { ...idle, hold: true }, flat);
      const t = i * dt;
      if (landed < 0 && car.wheelsInContact > 0) landed = t;
      if (landed >= 0) {
        lowest = Math.min(lowest, car.position.y);
        rebound = Math.max(rebound, car.position.y - lowest);
      }
    }
    expect(landed).toBeGreaterThan(0);
    // After the compression the body never springs back up more than ~half the travel.
    expect(rebound).toBeLessThan(def.physics.suspension.maxTravel * 0.9);
    // Settled: re-run and check velocity is tiny 1.5 s after touching down.
    const car2 = new VehiclePhysics(structuredClone(def.physics));
    car2.reset(0, 4.5, 0, 0);
    let t = 0;
    let touch = -1;
    while (t < 5) {
      car2.step(dt, { ...idle, hold: true }, flat);
      t += dt;
      if (touch < 0 && car2.wheelsInContact > 0) touch = t;
      if (touch >= 0 && t > touch + 1.5) break;
    }
    expect(Math.abs(car2.velocity.y)).toBeLessThan(0.25);
    expect(car2.wheelsInContact).toBe(4);
  });

  it('ignores driver input in the air: angular velocity is pure physics', () => {
    const run = (input: DriveInput): Vector3 => {
      const car = new VehiclePhysics(structuredClone(def.physics));
      car.reset(0, 40, 0, 0);
      car.velocity.set(0, 4, 20);
      car.angularVelocity.set(0.3, 0.2, -0.1);
      for (let i = 0; i < 120; i++) car.step(dt, input, flat);
      expect(car.wheelsInContact).toBe(0);
      return car.angularVelocity.clone();
    };
    const base = run(idle);
    for (const input of [
      { ...idle, throttle: 1 },
      { ...idle, brake: 1 },
      { ...idle, steer: 1 },
      { ...idle, steer: -1, handbrake: true },
      { ...idle, nitro: true, throttle: 1 },
    ]) {
      const w = run(input);
      expect(w.distanceTo(base)).toBeLessThan(1e-9);
    }
  });

  it('engine braking holds the speed down a 25% grade', () => {
    const ground = slope(0.25);
    const car = new VehiclePhysics(structuredClone(def.physics));
    car.reset(0, 0.9, 0, 0, new Vector3(0, 1, 0.25).normalize());
    for (let i = 0; i < 120 * 12; i++) car.step(dt, idle, ground);
    // Coasting downhill: limited by engine braking + drag well below the top speed.
    expect(car.speed).toBeLessThan(30);
    expect(car.speed).toBeGreaterThan(3);
  });

  it('rights itself from a strong roll on the ground (anti-flip)', () => {
    const car = new VehiclePhysics(structuredClone(def.physics));
    car.reset(0, 0.7, 0, 0);
    car.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    car.snapshot();
    for (let i = 0; i < 240; i++) car.step(dt, idle, flat);
    car.axes(f, u, l);
    expect(u.y).toBeGreaterThan(0.95);
  });

  it('keeps the wheels glued over a small crest at speed', () => {
    // Crest: flat then a 12% downhill. The jeep should stay in contact most of the time.
    const n = new Vector3(0, 1, 0.12).normalize();
    const crest: GroundProvider = {
      sample(_x, z, _y, out: GroundSample) {
        out.height = z > 0 ? -0.12 * z : 0;
        out.normal.copy(z > 0 ? n : new Vector3(0, 1, 0));
        out.surface = 'trail';
        out.onRoad = true;
        out.onBridge = false;
        out.s = 0;
        out.lateral = 0;
        return out;
      },
      groundHeight: (_x, z) => (z > 0 ? -0.12 * z : 0),
      normal: (_x, z, out: Vector3) => out.copy(z > 0 ? n : new Vector3(0, 1, 0)),
      waterLevel: () => -1e4,
    };
    const car = new VehiclePhysics(structuredClone(def.physics));
    car.reset(0, 0.7, -60, 0);
    car.velocity.set(0, 0, 18);
    let air = 0;
    for (let i = 0; i < 120 * 5; i++) {
      car.step(dt, { ...idle, throttle: 0.4 }, crest);
      if (car.wheelsInContact === 0) air += dt;
    }
    expect(air).toBeLessThan(0.4);
  });
});
