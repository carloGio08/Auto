import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { createDailyTrack, tracks } from '../src/data/tracks';
import { createRoadQuery, ROAD_JUMP } from '../src/terrain/road';
import { distanceToSegment } from '../src/terrain/terrain';

const dailies = ['2026-01-01', '2026-06-15', '2026-11-13', '2027-02-28'].map(createDailyTrack);

describe.each([...tracks, ...dailies].map((t) => [t.id, t] as const))(
  'road generation: %s',
  (_id, track) => {
    const course = new Course(track);
    const road = course.road;

    it('has evenly spaced, finite samples with unit tangents', () => {
      expect(road.count).toBeGreaterThan(300);
      for (let i = 0; i < road.count; i++) {
        expect(Number.isFinite(road.x[i] + road.y[i] + road.z[i])).toBe(true);
        expect(Math.hypot(road.tx[i], road.tz[i])).toBeCloseTo(1, 3);
        if (i > 0) {
          const d = Math.hypot(road.x[i] - road.x[i - 1], road.z[i] - road.z[i - 1]);
          expect(d).toBeGreaterThan(road.spacing * 0.9);
          expect(d).toBeLessThan(road.spacing * 1.1);
        }
      }
    });

    it('descends from the summit to the lake', () => {
      const drop = road.y[0] - road.y[road.count - 1];
      expect(drop).toBeGreaterThan(150);
      expect(road.y[road.count - 1]).toBeGreaterThan(track.terrain.lakeLevel);
    });

    it('keeps a drivable grade outside jumps', () => {
      let steep = 0;
      for (let i = 1; i < road.count; i++) {
        const grade = Math.abs(road.y[i] - road.y[i - 1]) / road.spacing;
        if (grade > 0.42 && !(road.flags[i] & ROAD_JUMP) && !(road.flags[i - 1] & ROAD_JUMP))
          steep++;
      }
      // Bumps on a steep stretch may reach ~35 %; only jump lips may exceed 42 %.
      expect(steep).toBe(0);
    });

    it('answers nearest-segment queries like a brute-force search', () => {
      const q = createRoadQuery();
      for (let k = 0; k < 300; k++) {
        const i = Math.floor(Math.random() * (road.count - 1));
        const x = road.x[i] + (Math.random() - 0.5) * 20;
        const z = road.z[i] + (Math.random() - 0.5) * 20;
        road.query(x, z, q);
        let best = Infinity;
        for (let j = 0; j < road.count - 1; j++) {
          best = Math.min(
            best,
            distanceToSegment(x, z, road.x[j], road.z[j], road.x[j + 1], road.z[j + 1]),
          );
        }
        expect(q.found).toBe(true);
        // The smooth (normal-interpolated) projection is within 2 % of the exact distance.
        expect(q.distance).toBeLessThanOrEqual(best * 1.02 + 0.02);
        expect(q.distance).toBeGreaterThanOrEqual(best - 1e-6);
      }
    });

    it('places collectibles above the ground', () => {
      for (const c of course.collectibles) {
        expect(Number.isFinite(c.y)).toBe(true);
        expect(c.y).toBeGreaterThan(course.terrain.height(c.x, c.z));
      }
    });
  },
);
