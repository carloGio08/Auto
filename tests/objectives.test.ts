import { describe, expect, it } from 'vitest';
import { dailyObjectives, objectiveValue } from '../src/data/objectives';
import { createDailyMountain } from '../src/data/mountains';

describe('daily objectives', () => {
  it('draws three distinct objectives deterministically from the seed', () => {
    const a = dailyObjectives(12345);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((o) => o.kind)).size).toBe(3);
    expect(dailyObjectives(12345)).toEqual(a);
    for (const o of a) expect(o.target).toBeGreaterThan(0);
  });

  it('varies between days and ships with the daily mountain', () => {
    const days = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map((d) =>
      JSON.stringify(createDailyMountain(d).objectives),
    );
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(createDailyMountain('2026-11-14').objectives).toHaveLength(3);
  });

  it('reads progress from the run', () => {
    const run = {
      score: 1200,
      coins: 7,
      crystals: 2,
      stats: { treesBroken: 4, longestDrift: 3.5, longestJump: 21 },
    };
    expect(objectiveValue('trees', run)).toBe(4);
    expect(objectiveValue('drift', run)).toBe(3.5);
    expect(objectiveValue('jump', run)).toBe(21);
    expect(objectiveValue('coins', run)).toBe(7);
    expect(objectiveValue('score', run)).toBe(1200);
    expect(objectiveValue('crystals', run)).toBe(2);
  });
});
