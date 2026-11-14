import { describe, expect, it } from 'vitest';
import { defaultPalette, paletteSize, resolvePalette } from '../src/data/palette';
import { surfaces } from '../src/data/surfaces';
import { MATERIALS } from '../src/terrain/biome';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { TerrainColorer, toPatchPalette, type VertexInfo } from '../src/terrain/splat';
import { Rng } from '../src/math/rng';
import { buildPatch } from '../src/terrain/patchBuilder';
import { config } from '../src/config';

describe('palette', () => {
  it('declares ramps of valid colours, a few dozen in all', () => {
    for (const [key, ramp] of Object.entries(defaultPalette)) {
      expect(ramp.length, key).toBeGreaterThanOrEqual(2);
      expect(ramp.length, key).toBeLessThanOrEqual(7);
      for (const c of ramp) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(paletteSize(defaultPalette)).toBeGreaterThanOrEqual(40);
    expect(paletteSize(defaultPalette)).toBeLessThanOrEqual(80);
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

  it('keeps neighbouring faces close in colour (no per-face noise) off the trails', () => {
    const course2 = new Course(mountains[0]);
    const pal2 = toPatchPalette(resolvePalette(defaultPalette));
    const n = 48;
    const cell = 1;
    const jumps: number[] = [];
    for (const [x0, z0] of [
      [-900, 300],
      [700, -900],
      [1200, 1500],
    ]) {
      const r = buildPatch(course2.terrain, pal2, { key: 1, gen: 0, x0, z0, size: n * cell, n });
      const c = r.color;
      const tris = r.count / 3 - n * 8;
      for (let t = 1; t < tris; t++) {
        // Consecutive triangles share a cell (or a neighbouring one).
        const a = t * 9;
        const b = (t - 1) * 9;
        const x = x0 + r.position[a] * r.unit;
        const z = z0 + r.position[a + 2] * r.unit;
        course2.terrain.height(x, z);
        const q = course2.terrain.lastQuery;
        if (q.found && q.distance < q.halfWidth + 4) continue;
        jumps.push(
          Math.max(
            Math.abs(c[a] - c[b]),
            Math.abs(c[a + 1] - c[b + 1]),
            Math.abs(c[a + 2] - c[b + 2]),
          ) / 255,
        );
      }
    }
    jumps.sort((p, q) => p - q);
    expect(jumps[Math.floor(jumps.length * 0.99)]).toBeLessThan(0.08);
  });

  it('bakes ambient occlusion within its configured range', () => {
    const course2 = new Course(mountains[0]);
    const colorer = new TerrainColorer(
      course2.terrain,
      toPatchPalette(resolvePalette(defaultPalette)),
    );
    const rng = new Rng(11);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 3000; i++) {
      const ao = colorer.occlusion(rng.range(-3000, 3000), rng.range(-3000, 3000), 1e4);
      lo = Math.min(lo, ao);
      hi = Math.max(hi, ao);
    }
    expect(lo).toBeGreaterThanOrEqual(1 - config.world.ao.strength - 1e-6);
    expect(hi).toBeLessThanOrEqual(1);
    // It actually varies: hollows darker than open ground.
    expect(hi - lo).toBeGreaterThan(config.world.ao.strength * 0.4);
    // Beside a trail it darkens.
    expect(colorer.occlusion(0, 0, 0.5)).toBeLessThan(colorer.occlusion(0, 0, 10));
  });
});
