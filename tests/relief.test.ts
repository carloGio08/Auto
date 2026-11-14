import { describe, expect, it } from 'vitest';
import { Mountain } from '../src/terrain/mountain';
import { mountains } from '../src/data/mountains';

/**
 * No uniform slopes: in every 200 m window outside the declared flats (meadows, terraces,
 * valley floors) the slope and the curvature must vary at least a little.
 */
describe.each(mountains.map((m) => [m.id, m] as const))('intermediate relief: %s', (_id, def) => {
  it('varies slope and curvature in every 200 m window outside the declared flats', () => {
    const m = new Mountain(def);
    m.buildRivers();
    const half = def.halfSize * 0.8;
    const sd = (a: number[]): number => {
      const mu = a.reduce((p, q) => p + q, 0) / a.length;
      return Math.sqrt(a.reduce((p, q) => p + (q - mu) ** 2, 0) / a.length);
    };
    let checked = 0;
    for (let wx = -half; wx < half - 200; wx += 200)
      for (let wz = -half; wz < half - 200; wz += 200) {
        const slopes: number[] = [];
        const curv: number[] = [];
        let flat = 0;
        let wet = 0;
        for (let x = wx; x < wx + 200; x += 10)
          for (let z = wz; z < wz + 200; z += 10) {
            const h = m.heightNoWater(x, z);
            if (m.waterLevel(x, z) > m.height(x, z)) wet++;
            const hx = m.heightNoWater(x + 4, z) - m.heightNoWater(x - 4, z);
            const hz = m.heightNoWater(x, z + 4) - m.heightNoWater(x, z - 4);
            slopes.push(Math.hypot(hx, hz) / 8);
            curv.push(
              (m.heightNoWater(x + 8, z) +
                m.heightNoWater(x - 8, z) +
                m.heightNoWater(x, z + 8) +
                m.heightNoWater(x, z - 8) -
                4 * h) /
                64,
            );
            flat += m.field.flat(x, z);
          }
        if (wet > 20 || flat / slopes.length > 0.3) continue;
        checked++;
        expect(sd(slopes), `slope at ${wx},${wz}`).toBeGreaterThan(0.03);
        expect(sd(curv), `curvature at ${wx},${wz}`).toBeGreaterThan(0.0055);
      }
    expect(checked).toBeGreaterThan(300);
  }, 120000);
});
