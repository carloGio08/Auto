import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { config } from '../src/config';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { toPatchPalette } from '../src/terrain/splat';
import { TerrainMesh } from '../src/terrain/terrainMesh';
import { TerrainService } from '../src/terrain/terrainService';
import { buildPatch, UNITS_PER_CELL } from '../src/terrain/patchBuilder';

const course = new Course(mountains[0]);
const pal = toPatchPalette(resolvePalette(defaultPalette));
const presets = config.graphics.presets;

describe('terrain LOD', () => {
  it.each(Object.keys(presets) as (keyof typeof presets)[])(
    '%s: LOD0 faces of the preset size and the triangle budget respected',
    (id) => {
      const p = presets[id];
      const mesh = new TerrainMesh(
        course.terrain,
        pal,
        { lod0Cell: p.terrainCell, lod0Radius: p.lod0Radius, triangleBudget: p.triangleBudget },
        TerrainService.local(course, pal),
      );
      expect(mesh.finestCell).toBeLessThanOrEqual(p.terrainCell * 1.0001);
      expect(mesh.finestCell).toBeGreaterThan(p.terrainCell * 0.9);
      const st = course.start;
      for (let i = 0; i < 300; i++) mesh.update(st.x, st.y + 4, st.z, 40);
      expect(mesh.visibleTriangles).toBeLessThanOrEqual(p.triangleBudget * 1.02);
      // The LOD0 ring keeps a useful radius even when shrunk to fit the budget.
      expect(p.lod0Radius * mesh.lodScale).toBeGreaterThan(60);
      mesh.dispose();
    },
    120000,
  );

  it('builds LOD0 patches whose longest triangle edge is the cell diagonal, with skirts', () => {
    const n = 40;
    const cell = presets.high.terrainCell;
    const st = course.start;
    const r = buildPatch(course.terrain, pal, {
      key: 1,
      gen: 0,
      x0: st.x - 20,
      z0: st.z - 20,
      size: n * cell,
      n,
    });
    expect(r.count / 3).toBe(n * n * 2 + n * 8);
    let longest = 0;
    const p = r.position;
    const u = r.unit;
    for (let t = 0; t < n * n * 2; t++) {
      for (let e = 0; e < 3; e++) {
        const a = (t * 3 + e) * 3;
        const b = (t * 3 + ((e + 1) % 3)) * 3;
        longest = Math.max(longest, Math.hypot(p[a] - p[b], p[a + 2] - p[b + 2]) * u);
      }
    }
    expect(longest).toBeCloseTo(cell * Math.SQRT2, 3);
    // Positions are exact multiples of the cell on the grid (no cracks between patches).
    expect(p[0] % UNITS_PER_CELL).toBe(0);
    // Heights within a few mm of the analytic surface.
    expect(
      Math.abs(p[1] * u + r.originY - course.terrain.height(st.x - 20, st.z - 20)),
    ).toBeLessThan(0.01);
  });
});
