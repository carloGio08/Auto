import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains, createDailyMountain } from '../src/data/mountains';
import { createRoadQuery } from '../src/terrain/road';
import { distanceToSegment } from '../src/terrain/terrain';
import { Rng } from '../src/math/rng';

const defs = [...mountains, ...['2026-01-01', '2026-06-15', '2027-02-28'].map(createDailyMountain)];

describe.each(defs.map((d) => [d.id, d] as const))('trail network: %s', (_id, def) => {
  const course = new Course(def);
  const road = course.road;

  it('routes every trail with evenly spaced, finite samples', () => {
    expect(road.trails.length).toBe(def.trails.length);
    for (const tr of road.trails) {
      expect(tr.count).toBeGreaterThan(50);
      for (let i = tr.start; i < tr.start + tr.count; i++) {
        expect(Number.isFinite(road.x[i] + road.y[i] + road.z[i] + road.bank[i])).toBe(true);
        expect(Math.hypot(road.tx[i], road.tz[i])).toBeCloseTo(1, 3);
        if (i > tr.start) {
          const d = Math.hypot(road.x[i] - road.x[i - 1], road.z[i] - road.z[i - 1]);
          expect(d).toBeGreaterThan(road.spacing * 0.5);
          expect(d).toBeLessThan(road.spacing * 1.35);
        }
      }
    }
  });

  it('descends the whole mountain on the main trail with a controlled grade', () => {
    const main = road.main;
    const y0 = road.y[main.start];
    const y1 = road.y[main.start + main.count - 1];
    expect(y0 - y1).toBeGreaterThan(1400);
    // A long descent: 6–14 km of trail.
    expect(main.length).toBeGreaterThan(6000);
    expect(main.length).toBeLessThan(14000);
    let steep = 0;
    for (let i = main.start + 1; i < main.start + main.count; i++) {
      if (Math.abs(road.y[i] - road.y[i - 1]) / road.spacing > main.def.maxGrade * 1.4) steep++;
    }
    expect(steep / main.count).toBeLessThan(0.01);
  });

  it('ends the main trail in the arrival zone at the base', () => {
    const last = road.main.start + road.main.count - 1;
    expect(course.inBase(road.x[last], road.z[last])).toBe(true);
  });

  it('answers nearest-trail queries consistently with a brute-force search', () => {
    const q = createRoadQuery();
    const rng = new Rng(5);
    for (let k = 0; k < 200; k++) {
      const i = rng.int(0, road.count - 2);
      const x = road.x[i] + rng.range(-10, 10);
      const z = road.z[i] + rng.range(-10, 10);
      road.query(x, z, q);
      let best = Infinity;
      for (let j = 0; j < road.count - 1; j++) {
        if (!road.segmentValid(j)) continue;
        best = Math.min(
          best,
          distanceToSegment(x, z, road.x[j], road.z[j], road.x[j + 1], road.z[j + 1]),
        );
      }
      expect(q.found).toBe(true);
      expect(q.distance).toBeLessThanOrEqual(best * 1.05 + 0.05);
    }
  });

  it('places collectibles and furniture above the ground', () => {
    for (const c of course.collectibles) {
      expect(Number.isFinite(c.y)).toBe(true);
      expect(c.y).toBeGreaterThan(course.terrain.height(c.x, c.z));
    }
    expect(course.waymarks.length + course.cairns.length).toBeGreaterThan(40);
    expect(course.signs.length).toBeGreaterThan(5);
  });
});
