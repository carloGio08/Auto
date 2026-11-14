import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { buildFarField, FarHeight } from '../src/terrain/farField';
import { toPatchPalette } from '../src/terrain/splat';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { lodLayout } from '../src/terrain/terrainMesh';
import { config } from '../src/config';

const course = new Course(mountains[0]);
const pal = toPatchPalette(resolvePalette(defaultPalette));

describe('far-field ring', () => {
  const p = config.graphics.presets.medium;
  const hole = lodLayout(p.terrainCell, course.def.halfSize * 2.5, p.patchCells).root / 2;
  const ff = buildFarField(course, pal, { hole, spacing: p.farSpacing, extent: p.farExtent });

  it('meets the quadtree edge at the terrain height (no seam with the last LOD)', () => {
    const pos = ff.position;
    let checked = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3];
      const z = pos[v * 3 + 2];
      const onEdge = Math.abs(Math.max(Math.abs(x), Math.abs(z)) - hole) < 1e-3;
      if (!onEdge) continue;
      expect(Math.abs(pos[v * 3 + 1] - course.terrain.height(x, z))).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('is continuous outwards: no step between neighbouring vertices beyond the slope', () => {
    const fh = new FarHeight(course, hole);
    let worst = 0;
    for (let r = hole; r < hole + 2000; r += 7) {
      const a = fh.height(r, 1234);
      const b = fh.height(r + 1, 1234);
      worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(2.5);
  });

  it('covers ~20 km in one indexed mesh, skipping the quadtree area', () => {
    const tris = ff.index.length / 3;
    expect(tris).toBeGreaterThan(10000);
    expect(tris).toBeLessThan(400000);
    for (let t = 0; t < ff.index.length; t += 3) {
      const v = ff.index[t];
      const x = ff.position[v * 3];
      const z = ff.position[v * 3 + 2];
      // Every triangle has a vertex on or outside the edge.
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeGreaterThan(hole - p.farSpacing * 1.5);
      if (t > 3000) break;
    }
    // The distant ranges rise well above the valley.
    let top = 0;
    for (let v = 1; v < ff.position.length; v += 3) top = Math.max(top, ff.position[v]);
    expect(top).toBeGreaterThan(2000);
  });
});
