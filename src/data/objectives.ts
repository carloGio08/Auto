import { Rng } from '../math/rng';

/** Measurable things a run can be asked to achieve. */
export type ObjectiveKind = 'trees' | 'drift' | 'jump' | 'coins' | 'score' | 'crystals';

export interface ObjectiveDef {
  kind: ObjectiveKind;
  target: number;
}

/** What a run exposes to objectives (read from the session). */
export interface ObjectiveSource {
  score: number;
  coins: number;
  crystals: number;
  stats: { treesBroken: number; longestDrift: number; longestJump: number };
}

export function objectiveValue(kind: ObjectiveKind, s: ObjectiveSource): number {
  switch (kind) {
    case 'trees':
      return s.stats.treesBroken;
    case 'drift':
      return s.stats.longestDrift;
    case 'jump':
      return s.stats.longestJump;
    case 'coins':
      return s.coins;
    case 'score':
      return s.score;
    case 'crystals':
      return s.crystals;
  }
}

/** Target ranges for the daily draw (inclusive), rounded to `step`. */
const POOL: Record<ObjectiveKind, { min: number; max: number; step: number }> = {
  trees: { min: 8, max: 25, step: 1 },
  drift: { min: 3, max: 6, step: 0.5 },
  jump: { min: 18, max: 40, step: 2 },
  coins: { min: 40, max: 90, step: 5 },
  score: { min: 15000, max: 40000, step: 1000 },
  crystals: { min: 2, max: 5, step: 1 },
};

/** Three different objectives with targets drawn deterministically from the day's seed. */
export function dailyObjectives(seed: number): ObjectiveDef[] {
  const rng = new Rng(seed ^ 0x0b7ec7);
  const kinds = Object.keys(POOL) as ObjectiveKind[];
  const out: ObjectiveDef[] = [];
  while (out.length < 3) {
    const kind = rng.pick(kinds);
    if (out.some((o) => o.kind === kind)) continue;
    const p = POOL[kind];
    const steps = Math.round((p.max - p.min) / p.step);
    out.push({ kind, target: p.min + rng.int(0, steps) * p.step });
  }
  return out;
}
