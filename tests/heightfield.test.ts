import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Course } from '../src/terrain/course';
import { mountains, createDailyMountain } from '../src/data/mountains';
import { createRoadPoint } from '../src/terrain/road';
import { Rng } from '../src/math/rng';

const defs = [...mountains, createDailyMountain('2026-11-14')];

describe.each(defs.map((d) => [d.id, d] as const))('mountain height(x, z): %s', (_id, def) => {
  const course = new Course(def);
  const terrain = course.terrain;
  const m = course.mountain;
  const half = def.halfSize;

  it('is finite over the whole map and has the expected scale', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = -half; x <= half; x += 97) {
      for (let z = -half; z <= half; z += 101) {
        const h = terrain.height(x, z);
        expect(Number.isFinite(h)).toBe(true);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    // 1500–2000 m from the summit to the base.
    expect(course.startAltitude - course.base.y).toBeGreaterThan(1500);
    expect(course.startAltitude - course.base.y).toBeLessThan(2100);
    expect(max).toBeGreaterThan(def.summit.height - 60);
  });

  it('has the designed mix of slopes: flats, gentle and medium slopes, faces, few walls', () => {
    const half = def.halfSize * 0.8;
    const bins = [0, 0, 0, 0];
    let n = 0;
    for (let x = -half; x < half; x += 37) {
      for (let z = -half; z < half; z += 37) {
        if (m.waterLevel(x, z) > m.height(x, z)) continue;
        // Large-scale slopes: the meso relief (terracettes, gullies, ribs) is tested apart.
        const h = m.heightMacro(x, z);
        const s = Math.hypot(m.heightMacro(x + 2, z) - h, m.heightMacro(x, z + 2) - h) / 2;
        const deg = (Math.atan(s) * 180) / Math.PI;
        bins[deg < 8 ? 0 : deg < 25 ? 1 : deg < 38 ? 2 : 3]++;
        n++;
      }
    }
    const [flat, medium, steep, walls] = bins.map((b) => b / n);
    // Target: ~25 % flat (<8°), ~45 % gentle/medium (8–25°), ~25 % steep (25–38°), <5 % walls.
    expect(flat).toBeGreaterThan(0.19);
    expect(flat).toBeLessThan(0.32);
    expect(medium).toBeGreaterThan(0.38);
    expect(medium).toBeLessThan(0.53);
    expect(steep).toBeGreaterThan(0.18);
    expect(steep).toBeLessThan(0.34);
    expect(walls).toBeLessThan(0.05);
  });

  it('has no spikes: bounded curvature of the natural surface', () => {
    const rng = new Rng(def.seed ^ 9);
    let worst = 0;
    let worstMeso = 0;
    const lapOf = (f: (x: number, z: number) => number, x: number, z: number): number => {
      const e = 1;
      const c = f(x, z);
      return (f(x + e, z) + f(x - e, z) + f(x, z + e) + f(x, z - e) - 4 * c) / (e * e);
    };
    const macro = (x: number, z: number): number => m.heightMacro(x, z);
    const meso = (x: number, z: number): number => m.heightNoWater(x, z) - m.heightMacro(x, z);
    for (let i = 0; i < 20000; i++) {
      const x = rng.range(-half * 0.8, half * 0.8);
      const z = rng.range(-half * 0.8, half * 0.8);
      worst = Math.max(worst, Math.abs(lapOf(macro, x, z)));
      worstMeso = Math.max(worstMeso, Math.abs(lapOf(meso, x, z)));
    }
    // A spike or a crease would show as a huge second derivative at 1 m. The meso relief
    // (terracettes, gullies, ribs) is smooth too, with its own, larger bound.
    expect(worst).toBeLessThan(0.25);
    expect(worstMeso).toBeLessThan(1.2);
  });

  it('is continuous (no steps from trail carving, rivers or the lake)', () => {
    const rng = new Rng(7);
    const b = course.road.bounds;
    for (let i = 0; i < 15000; i++) {
      const x = rng.range(b.minX - 40, b.maxX + 40);
      const z = rng.range(b.minZ - 40, b.maxZ + 40);
      const h0 = terrain.height(x, z);
      expect(Math.abs(terrain.height(x + 0.002, z) - h0)).toBeLessThan(0.02);
    }
  });

  it('carves the trail into the terrain: flat across, matching the profile', () => {
    const p = createRoadPoint();
    for (const [ti, tr] of course.road.trails.entries()) {
      for (let s = 60; s < tr.length - 60; s += 29) {
        course.road.pointAt(s, p, ti);
        // Skip bridges and hairpin apexes (the inside of a tight bend has no "across").
        if (course.road.flags[p.index] & 3 || course.road.isBridgeAt(s, 8, ti)) continue;
        const c = terrain.height(p.x, p.z);
        expect(Math.abs(c - p.y)).toBeLessThan(0.5);
        const l = terrain.height(p.x + p.tz * p.halfWidth * 0.8, p.z - p.tx * p.halfWidth * 0.8);
        const r = terrain.height(p.x - p.tz * p.halfWidth * 0.8, p.z + p.tx * p.halfWidth * 0.8);
        expect(Math.abs(l - r) / (p.halfWidth * 1.6)).toBeLessThan(0.14);
      }
    }
  });

  it('returns unit normals pointing up', () => {
    const n = new Vector3();
    const rng = new Rng(3);
    for (let i = 0; i < 300; i++) {
      terrain.normal(rng.range(-3000, 3000), rng.range(-3000, 3000), n);
      expect(n.length()).toBeCloseTo(1, 5);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('puts bridge decks above the water', () => {
    for (const b of course.road.bridges) {
      const p = course.road.pointAt((b.from + b.to) / 2, createRoadPoint(), b.trail);
      const deck = terrain.groundHeight(p.x, p.z, p.y + 1);
      expect(deck).toBeGreaterThan(terrain.waterLevel(p.x, p.z) + 0.5);
    }
  });
});
