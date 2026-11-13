import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Course } from '../src/terrain/course';
import { tracks } from '../src/data/tracks';
import { createRoadPoint } from '../src/terrain/road';

const course = new Course(tracks[0]);
const terrain = course.terrain;

describe('terrain height(x, z)', () => {
  it('is finite over the whole playable area', () => {
    for (let x = -800; x <= 800; x += 37) {
      for (let z = -600; z <= 1600; z += 41) {
        const h = terrain.height(x, z);
        expect(Number.isFinite(h)).toBe(true);
      }
    }
  });

  it('is continuous (no steps from the road blending)', () => {
    // For a continuous function halving the step roughly halves the difference; a step
    // (discontinuity) would keep it constant.
    const b = course.road.bounds;
    for (let i = 0; i < 20000; i++) {
      const x = b.minX - 40 + Math.random() * (b.maxX - b.minX + 80);
      const z = b.minZ - 40 + Math.random() * (b.maxZ - b.minZ + 80);
      const h0 = terrain.height(x, z);
      const d = Math.abs(terrain.height(x + 0.04, z) - h0);
      if (d < 0.02) continue;
      const half = Math.abs(terrain.height(x + 0.02, z) - h0);
      const quarter = Math.abs(terrain.height(x + 0.01, z) - h0);
      expect(quarter).toBeLessThan(d * 0.5);
      expect(half).toBeLessThan(d * 0.75);
    }
  });

  it('keeps the drivable road surface gentle across its width', () => {
    const p = createRoadPoint();
    for (let s = 20; s < course.road.length - 20; s += 7) {
      if (course.road.isBridgeAt(s, 8)) continue;
      course.road.pointAt(s, p);
      const l = terrain.height(p.x + p.tz * p.halfWidth * 0.9, p.z - p.tx * p.halfWidth * 0.9);
      const r = terrain.height(p.x - p.tz * p.halfWidth * 0.9, p.z + p.tx * p.halfWidth * 0.9);
      expect(Math.abs(l - r) / (p.halfWidth * 1.8)).toBeLessThan(0.12);
    }
  });

  it('matches the road profile on the road centre line', () => {
    const p = createRoadPoint();
    for (let s = 20; s < course.road.length - 20; s += 23) {
      if (course.road.isBridgeAt(s, 6)) continue;
      course.road.pointAt(s, p);
      expect(Math.abs(terrain.height(p.x, p.z) - p.y)).toBeLessThan(0.05);
    }
  });

  it('returns a unit normal pointing up', () => {
    const n = new Vector3();
    for (let i = 0; i < 200; i++) {
      terrain.normal(Math.random() * 600 - 300, Math.random() * 900, n);
      expect(n.length()).toBeCloseTo(1, 5);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('puts bridge decks above the river', () => {
    for (const b of course.road.bridges) {
      const p = course.road.pointAt((b.from + b.to) / 2, createRoadPoint());
      const deck = terrain.groundHeight(p.x, p.z, p.y + 1);
      expect(deck).toBeGreaterThan(terrain.waterLevel(p.x, p.z) + 1);
      expect(deck).toBeGreaterThan(terrain.height(p.x, p.z));
    }
  });
});
