import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { createRoadQuery } from '../src/terrain/road';
import {
  placeCell,
  rockReason,
  ROCK_STRIDE,
  TREE_STRIDE,
  type CellData,
} from '../src/world/propPlacement';
import { config } from '../src/config';
import { ecology, treeSpecies } from '../src/data/vegetation';

const course = new Course(mountains[0]);
const SIZE = config.world.propCellSize;
/** Rocks per km² over the central 6.4 × 6.4 km with the old placement rules. */
const BASELINE_ROCKS_PER_KM2 = 892;

const cells: CellData[] = [];
for (let cz = -10; cz < 10; cz += 2)
  for (let cx = -10; cx < 10; cx += 2) cells.push(placeCell(course, cx, cz, SIZE, 1));

describe('props placement', () => {
  it('keeps rocks few (≤ 30 % of the old density), each one where it makes sense', () => {
    let rocks = 0;
    let erratic = 0;
    for (const c of cells) {
      const n = c.rocks.length / ROCK_STRIDE;
      rocks += n;
      for (let i = 0; i < n; i++) if (rockReason(c, i) === 'erratic') erratic++;
    }
    const perKm2 = rocks / (cells.length * (SIZE / 1000) ** 2);
    expect(perKm2).toBeLessThan(BASELINE_ROCKS_PER_KM2 * 0.3);
    expect(erratic / rocks).toBeLessThan(0.3);
  });

  it('never puts a tree on a trail, in water or on slopes over ~40°, and keeps them apart', () => {
    const q = createRoadQuery();
    const t = course.terrain;
    let n = 0;
    for (const c of cells) {
      const tr = c.trees;
      const pts: [number, number][] = [];
      for (let k = 0; k < tr.length; k += TREE_STRIDE) {
        const x = tr[k + 2];
        const z = tr[k + 4];
        const h = t.height(x, z);
        course.road.query(x, z, q);
        if (q.found) expect(Math.abs(q.lateral - q.offset) - q.halfWidth).toBeGreaterThan(1.5);
        expect(t.waterLevel(x, z)).toBeLessThan(h);
        const slope =
          Math.hypot(
            t.height(x + 2, z) - t.height(x - 2, z),
            t.height(x, z + 2) - t.height(x, z - 2),
          ) / 4;
        expect(slope).toBeLessThan(0.95);
        pts.push([x, z]);
        n++;
      }
      // Poisson disk: no two trees closer than the minimum distance.
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThan(
            ecology.minTreeDistance - 1e-3,
          );
    }
    expect(n).toBeGreaterThan(500);
  }, 60000);

  it('groups trees into woods and glades (density far more variable than uniform)', () => {
    // Trees per 40 m square: the variance/mean ratio of a uniform (Poisson) layout is ~1.
    const counts: number[] = [];
    for (const c of cells) {
      const grid = new Array(64).fill(0);
      const x0 = c.cx * SIZE;
      const z0 = c.cz * SIZE;
      for (let k = 0; k < c.trees.length; k += TREE_STRIDE) {
        const i = Math.min(7, Math.floor((c.trees[k + 2] - x0) / 40));
        const j = Math.min(7, Math.floor((c.trees[k + 4] - z0) / 40));
        grid[j * 8 + i]++;
      }
      counts.push(...grid);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    expect(mean).toBeGreaterThan(0.5);
    expect(variance / mean).toBeGreaterThan(3);
    // Glades: many empty squares next to dense ones.
    expect(counts.filter((v) => v === 0).length / counts.length).toBeGreaterThan(0.3);
    expect(Math.max(...counts)).toBeGreaterThan(mean * 4);
  });

  it('gives trees realistic heights for their species and age (about 6–25 m)', () => {
    const heights: number[] = [];
    for (const c of cells)
      for (let k = 0; k < c.trees.length; k += TREE_STRIDE) {
        const sp = treeSpecies[c.trees[k]];
        const h = c.trees[k + 5];
        heights.push(h);
        expect(h).toBeGreaterThan(sp.shape === 'dwarf' ? 1 : 3);
        expect(h).toBeLessThanOrEqual(25.01);
        expect(c.trees[k + 6]).toBeGreaterThan(0.2);
      }
    heights.sort((a, b) => a - b);
    const p = (f: number): number => heights[Math.floor(heights.length * f)];
    // A mix of young, medium and old trees: a wide, continuous spread of sizes.
    expect(p(0.1)).toBeLessThan(9);
    expect(p(0.5)).toBeGreaterThan(9);
    expect(p(0.5)).toBeLessThan(17);
    expect(p(0.95)).toBeGreaterThan(16);
  });

  it('grows forests on slopes rather than on flat terraces, none above the tree line', () => {
    const bio = course.terrain.biomes;
    const b = course.def.biomes;
    expect(bio.forestDensity(0, 0, b.treeLine + 200, 0.3, 0.5)).toBe(0);
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

  it('places the same trees on both sides of a cell border (seamless Poisson disk)', () => {
    const a = placeCell(course, 0, 2, SIZE, 1);
    const b = placeCell(course, 1, 2, SIZE, 1);
    // No pair across the border closer than the minimum distance.
    for (let i = 0; i < a.trees.length; i += TREE_STRIDE)
      for (let j = 0; j < b.trees.length; j += TREE_STRIDE) {
        const d = Math.hypot(a.trees[i + 2] - b.trees[j + 2], a.trees[i + 4] - b.trees[j + 4]);
        expect(d).toBeGreaterThan(ecology.minTreeDistance - 1e-3);
      }
  });
});
