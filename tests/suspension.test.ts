import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { cars } from '../src/data/cars';
import { VehiclePhysics } from '../src/vehicle/physics';
import { Autopilot } from '../src/vehicle/autopilot';
import { createRoadPoint, createRoadQuery } from '../src/terrain/road';
import { createGroundSample } from '../src/terrain/terrain';

const course = new Course(mountains[0]);
const dt = 1 / 120;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

function spawn(car: VehiclePhysics, s: number, lift = 0.8): void {
  const p = course.road.pointAt(s, createRoadPoint());
  const g = course.terrain.sample(p.x, p.z, p.y + 5, createGroundSample());
  car.reset(p.x, g.height + lift, p.z, Math.atan2(p.tx, p.tz));
}

describe.each(cars.map((c) => [c.id, c] as const))('vehicle physics: %s', (_id, def) => {
  it('stays finite for 10 000 steps of mixed driving', () => {
    const car = new VehiclePhysics(structuredClone(def.physics));
    spawn(car, course.startS);
    const input = { ...idle };
    for (let i = 0; i < 10000; i++) {
      const t = i * dt;
      input.throttle = Math.sin(t * 0.7) > -0.3 ? 1 : 0;
      input.brake = Math.sin(t * 0.7) < -0.6 ? 1 : 0;
      input.steer = Math.sin(t * 1.3);
      input.handbrake = Math.sin(t * 2.1) > 0.8;
      input.nitro = Math.sin(t * 0.4) > 0.5;
      car.step(dt, input, course.terrain);
      expect(car.isFinite()).toBe(true);
      expect(car.invalid).toBe(false);
      expect(car.speed).toBeLessThanOrEqual(90.0001);
    }
  });

  it('settles at rest with the suspension partly compressed', () => {
    const car = new VehiclePhysics(structuredClone(def.physics));
    spawn(car, 6);
    for (let i = 0; i < 600; i++) car.step(dt, { ...idle, hold: true }, course.terrain);
    expect(car.wheelsInContact).toBe(4);
    expect(car.speed).toBeLessThan(1);
    for (const w of car.wheels) {
      expect(w.compression).toBeGreaterThan(0.02);
      expect(w.compression).toBeLessThan(def.physics.suspension.maxTravel);
    }
  });

  it('survives a 15 m drop without exploding', () => {
    const car = new VehiclePhysics(structuredClone(def.physics));
    spawn(car, 200, 15);
    car.angularVelocity.set(0.8, 0, 0.5);
    let maxW = 0;
    for (let i = 0; i < 600; i++) {
      car.step(dt, idle, course.terrain);
      maxW = Math.max(maxW, car.angularVelocity.length());
      expect(car.isFinite()).toBe(true);
      const ground = course.terrain.groundHeight(
        car.position.x,
        car.position.z,
        car.position.y + 2,
      );
      expect(car.position.y).toBeGreaterThan(ground - 1.5);
    }
    expect(maxW).toBeLessThanOrEqual(16.0001);
    expect(car.speed).toBeLessThan(25);
  });
});

describe('autopilot integration', () => {
  it('drives the first 2 km of the main trail down from the summit', () => {
    const car = new VehiclePhysics(structuredClone(cars[0].physics));
    spawn(car, course.startS);
    const ap = new Autopilot(course.road);
    const q = createRoadQuery();
    const input = { ...idle };
    let s = course.startS;
    let resets = 0;
    let t = 0;
    let lastS = s;
    let stuck = 0;
    const target = 2000;
    while (t < 240 && s < target) {
      course.road.query(car.position.x, car.position.z, q);
      if (q.found && q.s > s - 30 && q.s < s + 40) s = Math.max(s, q.s);
      ap.drive(car, s, input);
      car.step(dt, input, course.terrain);
      t += dt;
      if (s > lastS + 1) {
        lastS = s;
        stuck = 0;
      } else stuck += dt;
      if (!q.found || q.distance > 30 || stuck > 4 || car.submerged > 0.7) {
        stuck = 0;
        resets++;
        spawn(car, s);
      }
    }
    expect(s).toBeGreaterThanOrEqual(target);
    expect(t).toBeLessThan(200);
    expect(resets).toBeLessThan(6);
  }, 60000);
});
