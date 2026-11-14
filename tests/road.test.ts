import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains, createDailyMountain } from '../src/data/mountains';
import {
  createRoadPoint,
  createRoadQuery,
  ROAD_BRIDGE,
  ROAD_FORD,
  ROAD_HAIRPIN,
  ROAD_LAYBY,
} from '../src/terrain/road';
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
    // A long descent at ~8–12 % on average: 10–19 km of trail.
    expect(main.length).toBeGreaterThan(10000);
    expect(main.length).toBeLessThan(19000);
    const avg = (y0 - y1) / main.length;
    expect(avg).toBeGreaterThan(0.075);
    expect(avg).toBeLessThan(0.13);
  });

  it('keeps every trail within its grade limit (20 m windows) and its bends drivable', () => {
    const W = 10;
    for (const tr of road.trails) {
      let worst = 0;
      let minRadius = Infinity;
      // Junction ends (first/last 30 m of branches) follow the trail they join.
      const skip = tr.def.kind === 'main' ? W : 20;
      for (let i = tr.start + skip; i < tr.start + tr.count - skip; i++) {
        // Bridge decks and ford dips are checked separately.
        let special = 0;
        for (let k = i - W; k <= i + W; k++) special |= road.flags[k] & (ROAD_BRIDGE | ROAD_FORD);
        if (special) continue;
        worst = Math.max(worst, Math.abs(road.y[i + W] - road.y[i - W]) / (2 * W * road.spacing));
        minRadius = Math.min(minRadius, 1 / Math.max(1e-6, Math.abs(road.curvature[i])));
      }
      // Main trail: ~20 % at most; shortcuts up to ~30 %.
      expect(worst).toBeLessThan(tr.def.maxGrade * 1.25);
      expect(minRadius).toBeGreaterThan(5.5);
    }
  });

  it('crosses streams on bridges (main trail) or fords with gentle ramps', () => {
    const q = createRoadPoint();
    for (const f of road.fords) {
      const tr = road.trails[f.trail];
      expect(tr.def.kind).not.toBe('main');
      // The sample of the ford closest to the stream.
      let best = Infinity;
      let depth = 0;
      for (let s = f.from; s <= f.to; s += road.spacing) {
        const p = road.pointAt(s, q, f.trail);
        const d = course.mountain.riverDistance(p.x, p.z);
        if (d < best) {
          best = d;
          depth = course.terrain.waterLevel(p.x, p.z) - p.y;
        }
      }
      // Shallow: wheels in the water, chassis dry.
      expect(depth).toBeGreaterThan(0.1);
      expect(depth).toBeLessThan(0.8);
    }
  });

  it('varies the trail: width 4–7 m, surfaces, lay-bys', () => {
    const main = road.main;
    let minW = Infinity;
    let maxW = 0;
    const kinds = new Set<number>();
    let longest = 0;
    let run = 0;
    for (let i = main.start + 1; i < main.start + main.count; i++) {
      if (road.flags[i] & (ROAD_HAIRPIN | ROAD_LAYBY | ROAD_BRIDGE)) continue;
      minW = Math.min(minW, road.halfWidth[i] * 2);
      // Bends widen a little: the 4–7 m range is for the straights.
      let bend = false;
      for (let k = Math.max(main.start, i - 10); k < Math.min(main.start + main.count, i + 10); k++)
        if (Math.abs(road.curvature[k]) > 1 / 70) bend = true;
      if (!bend) maxW = Math.max(maxW, road.halfWidth[i] * 2);
      kinds.add(road.surf[i]);
      run = road.surf[i] === road.surf[i - 1] ? run + road.spacing : 0;
      longest = Math.max(longest, run);
    }
    expect(minW).toBeGreaterThan(3.9);
    expect(maxW).toBeLessThan(7.6);
    expect(kinds.size).toBe(3);
    // The surface never stays the same for kilometres.
    expect(longest).toBeLessThan(900);
    expect(road.laybys.length).toBeGreaterThan(5);
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
