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

  it('respects the slope limit (only a few explicit cliffs and the rim exceed it)', () => {
    const rng = new Rng(def.seed);
    let over = 0;
    let n = 0;
    const lim = def.maxSlope;
    for (let i = 0; i < 20000; i++) {
      const x = rng.range(-half * 0.78, half * 0.78);
      const z = rng.range(-half * 0.78, half * 0.78);
      const nearCliff = def.cliffs.some((c) => Math.hypot(x - c.x, z - c.z) < c.length * 0.6);
      if (nearCliff) continue;
      const h = m.heightNoWater(x, z);
      const s = Math.hypot(m.heightNoWater(x + 2, z) - h, m.heightNoWater(x, z + 2) - h) / 2;
      n++;
      if (s > lim) over++;
    }
    expect(over / n).toBeLessThan(0.03);
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
        if (course.road.flags[p.index] & 3) continue;
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
