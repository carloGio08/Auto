import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { createRoadQuery } from '../src/terrain/road';
import { isRock, placeCell, PROP_TYPES } from '../src/world/propPlacement';
import { config } from '../src/config';

const course = new Course(mountains[0]);
const SIZE = config.world.propCellSize;
/** Rocks per km² over the central 6.4 × 6.4 km with the previous placement rules. */
const BASELINE_ROCKS_PER_KM2 = 892;

describe('props placement', () => {
  it('has at least 70 % fewer rocks than before, each one where it makes sense', () => {
    let rocks = 0;
    let erratic = 0;
    let cells = 0;
    for (let cz = -10; cz < 10; cz += 2)
      for (let cx = -10; cx < 10; cx += 2) {
        const p = placeCell(course, cx, cz, SIZE, 1);
        cells++;
        rocks += p.instances.filter((i) => isRock(PROP_TYPES[i.type])).length;
        erratic += p.rockReasons.filter((r) => r === 'erratic').length;
      }
    const perKm2 = rocks / (cells * (SIZE / 1000) ** 2);
    expect(perKm2).toBeLessThan(BASELINE_ROCKS_PER_KM2 * 0.3);
    // Scattered "erratic" boulders are the exception, not the rule.
    expect(erratic / rocks).toBeLessThan(0.3);
  });

  it('keeps trees and rocks off the worn band of every trail', () => {
    const q = createRoadQuery();
    const road = course.road;
    const seen = new Set<string>();
    let checked = 0;
    for (const tr of road.trails) {
      for (let i = tr.start; i < tr.start + tr.count; i += 40) {
        const cx = Math.floor(road.x[i] / SIZE);
        const cz = Math.floor(road.z[i] / SIZE);
        const key = `${cx},${cz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const inst of placeCell(course, cx, cz, SIZE, 1).instances) {
          course.terrain.height(inst.x, inst.z);
          road.query(inst.x, inst.z, q);
          if (!q.found) continue;
          const edge = Math.abs(q.lateral - q.offset) - q.halfWidth;
          const radius = isRock(PROP_TYPES[inst.type]) ? 0.95 * inst.scale : 0.5 * inst.scale;
          expect(edge).toBeGreaterThan(radius);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('grows forests in valleys and on medium slopes, leaves meadows and high ground open', () => {
    const bio = course.terrain.biomes;
    const b = course.def.biomes;
    // Above the tree line: no forest.
    expect(bio.forestDensity(0, 0, b.treeLine + 200, 0.3, 0.5)).toBe(0);
    // Flat terrace vs medium slope at the same altitude, same spot.
    let flat = 0;
    let slope = 0;
    for (let k = 0; k < 50; k++) {
      const x = -1500 + k * 61;
      const z = 600 + k * 17;
      flat += bio.forestDensity(x, z, b.denseForestLine - 50, 0.03, 0.5);
      slope += bio.forestDensity(x, z, b.denseForestLine - 50, 0.35, 0.5);
    }
    expect(slope).toBeGreaterThan(flat * 3);
  });
});
