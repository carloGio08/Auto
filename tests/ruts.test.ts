import { describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import { config } from '../src/config';
import { mountains } from '../src/data/mountains';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { Course } from '../src/terrain/course';
import { createRoadPoint, createRoadQuery, ROAD_BRIDGE, ROAD_FORD } from '../src/terrain/road';
import { RutDecals } from '../src/world/rutDecals';

const course = new Course(mountains[0]);
const terrain = course.terrain;
const road = terrain.road;
const R = config.world.ruts;

describe('baked wheel ruts', () => {
  it('run along the whole trail with a 3–5 cm depression (none on bridges and fords)', () => {
    const [d0, d1] = R.depth;
    expect(d0).toBeGreaterThanOrEqual(0.03);
    expect(d1).toBeLessThanOrEqual(0.05);
    const main = road.main;
    let ruts = 0;
    for (let i = main.start; i < main.start + main.count; i++) {
      const wet = road.flags[i] & (ROAD_BRIDGE | ROAD_FORD);
      if (wet) {
        expect(road.rut[i]).toBe(0);
        continue;
      }
      expect(road.rut[i]).toBeLessThanOrEqual(d1 + 1e-6);
      if (road.rut[i] >= d0 - 0.004) ruts++;
    }
    // Almost every sample (the rest are smoothed transitions next to bridges and fords).
    expect(ruts / main.count).toBeGreaterThan(0.95);
  });

  it('depress the ground by at most 5 cm, deepest on the rut lines', () => {
    const q = createRoadQuery();
    const main = road.main;
    let checked = 0;
    for (let i = main.start + 50; i < main.start + main.count - 50; i += 37) {
      if (road.flags[i] & (ROAD_BRIDGE | ROAD_FORD)) continue;
      road.query(road.x[i], road.z[i], q);
      if (!q.found) continue;
      // Rut profile alone: packed dirt, above the puddle line.
      q.surf = 0;
      q.y = 1e9;
      let best = 0;
      let bestLat = 0;
      for (let l = 0; l <= 1.6; l += 0.01) {
        const d = terrain.microRelief(q, l);
        if (d > best) {
          best = d;
          bestLat = l;
        }
      }
      expect(best).toBeGreaterThanOrEqual(0.0299);
      expect(best).toBeLessThanOrEqual(0.05 + 1e-6);
      expect(Math.abs(bestLat - R.offset)).toBeLessThan(0.02);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('draws crisp ribbons that follow the spline and lie on the ground', () => {
    const ruts = new RutDecals(terrain, resolvePalette(defaultPalette));
    const p = road.pointAt(3000, createRoadPoint());
    ruts.update(p.x, p.z);
    const pos = ruts.mesh.geometry.attributes.position as BufferAttribute;
    const n = (ruts.mesh.geometry.drawRange.count / 30) * 12;
    expect(n).toBeGreaterThan(100);
    const q = createRoadQuery();
    let worst = 0;
    let worstH = 0;
    for (let v = 0; v < n; v += 6) {
      // Middle of each ribbon row (vertices 2 and 3 of the 6-vertex profile).
      const x = (pos.getX(v + 2) + pos.getX(v + 3)) / 2;
      const z = (pos.getZ(v + 2) + pos.getZ(v + 3)) / 2;
      const y = (pos.getY(v + 2) + pos.getY(v + 3)) / 2;
      road.query(x, z, q);
      if (!q.found) continue;
      worst = Math.max(worst, Math.abs(Math.abs(q.lateral) - R.offset));
      worstH = Math.max(worstH, Math.abs(y - R.lift - terrain.height(x, z)));
    }
    // Lateral error against the spline: a few cm (the polyline chord on bends).
    expect(worst).toBeLessThan(0.08);
    expect(worstH).toBeLessThan(0.06);
    ruts.dispose();
  });
});
