import { describe, expect, it } from 'vitest';
import { defaultPalette, paletteSize, resolvePalette } from '../src/data/palette';
import { surfaces } from '../src/data/surfaces';
import { MATERIALS } from '../src/terrain/biome';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { TerrainColorer, toPatchPalette, type VertexInfo } from '../src/terrain/splat';
import { Rng } from '../src/math/rng';

describe('palette', () => {
  it('declares ramps of valid colours, a few dozen in all', () => {
    for (const [key, ramp] of Object.entries(defaultPalette)) {
      expect(ramp.length, key).toBeGreaterThanOrEqual(2);
      expect(ramp.length, key).toBeLessThanOrEqual(7);
      for (const c of ramp) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(paletteSize(defaultPalette)).toBeGreaterThanOrEqual(40);
    expect(paletteSize(defaultPalette)).toBeLessThanOrEqual(72);
  });

  it('has an entry for every material and surface colour used', () => {
    for (const m of MATERIALS) expect(defaultPalette[m]).toBeDefined();
    for (const s of Object.values(surfaces)) expect(defaultPalette[s.color]).toBeDefined();
  });

  it('blends terrain colours only from palette tones, smoothly from vertex to vertex', () => {
    const course = new Course(mountains[0]);
    const pal = toPatchPalette(resolvePalette(defaultPalette));
    const colorer = new TerrainColorer(course.terrain, pal);
    // Bounds of all palette channels.
    let lo = 1;
    let hi = 0;
    for (const a of Object.values(pal))
      for (const v of a) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    const rng = new Rng(4);
    const out = new Float32Array(6);
    const v = (x: number, z: number): VertexInfo => {
      const h = course.terrain.height(x, z);
      const q = course.terrain.lastQuery;
      const e = 1;
      const dx = course.terrain.height(x + e, z) - course.terrain.height(x - e, z);
      const dz = course.terrain.height(x, z + e) - course.terrain.height(x, z - e);
      const l = Math.hypot(dx, 2 * e, dz);
      return {
        x,
        z,
        h,
        nx: -dx / l,
        ny: (2 * e) / l,
        nz: -dz / l,
        curvature: 0,
        roadDistance: q.found ? q.distance : 1e4,
        halfWidth: q.found ? q.halfWidth : 0,
        lateral: q.found ? q.lateral : 0,
        s: q.found ? q.s : 0,
        trail: q.found ? q.trail : -1,
      };
    };
    const jumps: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const x = rng.range(-3000, 3000);
      const z = rng.range(-3000, 3000);
      const a = v(x, z);
      if (a.roadDistance < a.halfWidth + 4) continue;
      colorer.vertex(a, out, 0);
      colorer.vertex(v(x + 1, z), out, 3);
      for (let k = 0; k < 6; k++) {
        expect(out[k]).toBeGreaterThanOrEqual(lo - 1e-4);
        expect(out[k]).toBeLessThanOrEqual(hi + 1e-4);
      }
      jumps.push(Math.max(...[0, 1, 2].map((k) => Math.abs(out[k] - out[k + 3]))));
    }
    jumps.sort((a, b) => a - b);
    // No hard bands: between vertices 1 m apart the colour changes only a little.
    expect(jumps[Math.floor(jumps.length * 0.99)]).toBeLessThan(0.12);
  });
});
