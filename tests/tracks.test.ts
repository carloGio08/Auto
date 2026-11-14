import { describe, expect, it } from 'vitest';
import { TrackBuffer, TireTracks, TRACK_CAPACITY } from '../src/effects/tireTracks';
import { defaultPalette, resolvePalette } from '../src/data/palette';

describe('tyre track buffer', () => {
  it('never holds more than its capacity and overwrites the oldest segments first', () => {
    const b = new TrackBuffer(8);
    const slots: number[] = [];
    for (let i = 0; i < 12; i++) {
      const s = b.alloc();
      b.meta(s, i, 0, 1000);
      slots.push(s);
    }
    expect(b.count).toBe(8);
    // Ring order: segments 8..11 reused the slots of segments 0..3.
    expect(slots.slice(8)).toEqual(slots.slice(0, 4));
  });

  it('reuses freed slots (expired or far away) before overwriting live ones', () => {
    const b = new TrackBuffer(6);
    for (let i = 0; i < 6; i++) b.meta(b.alloc(), i * 100, 0, i === 2 ? 5 : 1000);
    // Segment 2 has expired, segments beyond 350 m from x = 0 are discarded.
    b.sweep(10, 0, 0, 350);
    expect(b.count).toBe(3);
    const reused = new Set([b.alloc(), b.alloc(), b.alloc()]);
    expect(reused).toEqual(new Set([2, 4, 5]));
    expect(b.isAlive(0) && b.isAlive(1) && b.isAlive(3)).toBe(true);
    expect(b.count).toBe(6);
  });

  it('tracks only the dirty range for incremental uploads', () => {
    const b = new TrackBuffer(10);
    b.alloc();
    b.alloc();
    expect([b.dirtyMin, b.dirtyMax]).toEqual([0, 1]);
  });

  it('lays segments on the ground every 0.4 m, following its height', () => {
    const ground = { groundHeight: (x: number) => 100 + x * 0.1 };
    const t = new TireTracks(ground, resolvePalette(defaultPalette), TRACK_CAPACITY.low);
    const w = {
      contact: true,
      x: 0,
      y: 100,
      z: 0,
      surface: 'snow' as const,
      skid: 0,
      load: 1,
      spin: 0,
      inWater: false,
    };
    for (let i = 0; i <= 100; i++) {
      w.x = i * 0.1;
      t.step(1 / 120, 0, w, 0.36, 1, 0, false, 0);
    }
    // 10 m → ~25 segments.
    expect(t.buffer.count).toBeGreaterThan(20);
    expect(t.buffer.count).toBeLessThan(30);
    const p = t.buffer.pos;
    // Every vertex sits 3.5 cm above the sampled ground.
    for (let v = 0; v < t.buffer.count * 6; v++) {
      const x = p[v * 3];
      expect(p[v * 3 + 1] - (100 + x * 0.1)).toBeCloseTo(0.035, 4);
    }
    // In water: no track.
    w.inWater = true;
    const before = t.buffer.count;
    for (let i = 0; i < 20; i++) {
      w.x += 0.5;
      t.step(1 / 120, 0, w, 0.36, 1, 0, false, 0);
    }
    expect(t.buffer.count).toBe(before);
    t.dispose();
  });
});
