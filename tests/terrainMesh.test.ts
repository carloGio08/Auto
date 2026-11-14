import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { config } from '../src/config';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { toPatchPalette } from '../src/terrain/splat';
import { TerrainMesh } from '../src/terrain/terrainMesh';
import { TerrainService } from '../src/terrain/terrainService';
import { buildPatch } from '../src/terrain/patchBuilder';

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
        {
          lod0Cell: p.terrainCell,
          lod0Radius: p.lod0Radius,
          triangleBudget: p.triangleBudget,
          maxPatchCells: p.patchCells,
        },
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

  /** Edge ratio (longest / shortest edge, in 3D) of every non-skirt triangle of a patch. */
  const edgeRatios = (r: ReturnType<typeof buildPatch>, n: number): number[] => {
    const p = r.position;
    const u = r.unit;
    const out: number[] = [];
    for (let t = 0; t < r.count / 3 - n * 8; t++) {
      const e: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = (t * 3 + k) * 3;
        const b = (t * 3 + ((k + 1) % 3)) * 3;
        e.push(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]) * u);
      }
      out.push(Math.max(...e) / Math.min(...e));
    }
    return out;
  };

  it('builds small, well shaped LOD0 faces, even on steep ground', () => {
    const n = 40;
    const cell = presets.high.terrainCell;
    // The steepest drivable spot near the summit and the start.
    let sx = 0;
    let sz = 0;
    let best = 0;
    for (let x = -2500; x < 2500; x += 97)
      for (let z = -2500; z < 2000; z += 89) {
        const h = course.terrain.height(x, z);
        const sl =
          Math.hypot(course.terrain.height(x + 3, z) - h, course.terrain.height(x, z + 3) - h) / 3;
        if (sl > best && sl < 0.9) {
          best = sl;
          sx = x;
          sz = z;
        }
      }
    expect(best).toBeGreaterThan(0.6);
    for (const [x, z] of [
      [sx, sz],
      [course.start.x, course.start.z],
    ]) {
      const r = buildPatch(course.terrain, pal, {
        key: 1,
        gen: 0,
        x0: x - (n * cell) / 2,
        z0: z - (n * cell) / 2,
        size: n * cell,
        n,
      });
      // At least two triangles per cell, more on steep edges, plus the skirts.
      expect(r.count / 3).toBeGreaterThanOrEqual(n * n * 2 + n * 8);
      const ratios = edgeRatios(r, n);
      const good = ratios.filter((q) => q < 3).length / ratios.length;
      expect(good).toBeGreaterThan(0.9);
      // Longest horizontal extent of a face: about the jittered cell diagonal.
      let longest = 0;
      const p = r.position;
      for (let t = 0; t < r.count / 3 - n * 8; t++)
        for (let e = 0; e < 3; e++) {
          const a = (t * 3 + e) * 3;
          const b = (t * 3 + ((e + 1) % 3)) * 3;
          longest = Math.max(longest, Math.hypot(p[a] - p[b], p[a + 2] - p[b + 2]) * r.unit);
        }
      expect(longest).toBeLessThan(cell * Math.SQRT2 * 1.55);
    }
  });

  it('keeps every vertex on the true surface and shares jittered borders between patches', () => {
    const n = 32;
    const cell = presets.high.terrainCell;
    const st = course.start;
    const a = buildPatch(course.terrain, pal, {
      key: 1,
      gen: 0,
      x0: st.x,
      z0: st.z,
      size: n * cell,
      n,
    });
    const b = buildPatch(course.terrain, pal, {
      key: 2,
      gen: 0,
      x0: st.x + n * cell,
      z0: st.z,
      size: n * cell,
      n,
    });
    // Heights within a centimetre of height(x, z) at the (jittered) vertex position.
    for (let v = 0; v < a.count; v += 7) {
      const x = st.x + a.position[v * 3] * a.unit;
      const z = st.z + a.position[v * 3 + 2] * a.unit;
      const y = a.position[v * 3 + 1] * a.unit + a.originY;
      if (v / 3 >= a.count / 3 - n * 8) break;
      expect(Math.abs(y - course.terrain.height(x, z))).toBeLessThan(0.02);
    }
    // The right border of A and the left border of B: same set of world points.
    const border = (r: typeof a, x0: number, onX: number): string[] => {
      const out = new Set<string>();
      for (let v = 0; v < r.count - n * 24; v++) {
        const x = x0 + r.position[v * 3] * r.unit;
        if (Math.abs(x - onX) > 1e-3) continue;
        const z = st.z + r.position[v * 3 + 2] * r.unit;
        out.add(`${z.toFixed(2)}:${(r.position[v * 3 + 1] * r.unit + r.originY).toFixed(1)}`);
      }
      return [...out].sort();
    };
    expect(border(a, st.x, st.x + n * cell)).toEqual(border(b, st.x + n * cell, st.x + n * cell));
  });
});
