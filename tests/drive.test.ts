import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { cars } from '../src/data/cars';
import { VehiclePhysics } from '../src/vehicle/physics';
import { Autopilot } from '../src/vehicle/autopilot';
import { createRoadPoint, createRoadQuery } from '../src/terrain/road';
import { createGroundSample } from '../src/terrain/terrain';

const dt = 1 / 120;

/**
 * Drivability without rendering: a bot follows the main trail with the real jeep physics
 * from the summit to the village. It must never get stuck nor roll over.
 */
describe.each(mountains.map((m) => [m.id, m] as const))('full descent bot: %s', (_id, def) => {
  it('drives the whole main trail from the summit to the base', () => {
    const course = new Course(def);
    const road = course.road;
    const car = new VehiclePhysics(structuredClone(cars[0].physics));
    const p = road.pointAt(course.startS, createRoadPoint());
    const g = course.terrain.sample(p.x, p.z, p.y + 5, createGroundSample());
    car.reset(p.x, g.height + 0.8, p.z, Math.atan2(p.tx, p.tz));
    const ap = new Autopilot(road);
    const q = createRoadQuery();
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    let s = course.startS;
    let t = 0;
    let lastS = s;
    let stuck = 0;
    let worstStuck = 0;
    let rolled = 0;
    let lost = 0;
    const end = road.length - 25;
    while (t < 1800 && s < end) {
      road.query(car.position.x, car.position.z, q);
      if (q.found && q.trail === 0 && q.s > s - 30 && q.s < s + 40) s = Math.max(s, q.s);
      ap.drive(car, s, input);
      car.step(dt, input, course.terrain);
      t += dt;
      if (s > lastS + 1) {
        lastS = s;
        stuck = 0;
      } else stuck += dt;
      worstStuck = Math.max(worstStuck, stuck);
      if (car.upsideDownTime > 1) rolled++;
      if (!q.found || q.distance > 30) lost++;
      expect(car.isFinite()).toBe(true);
      if (stuck > 20) break;
    }
    expect(s).toBeGreaterThanOrEqual(end);
    // Never stuck for long, never on its roof, never far off the trail.
    expect(worstStuck).toBeLessThan(6);
    expect(rolled).toBe(0);
    expect(lost).toBe(0);
    // A 14–17 km descent at a sensible pace.
    expect(t).toBeLessThan(1500);
  }, 240000);
});
