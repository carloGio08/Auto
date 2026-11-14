import type { TreeTier } from '../world/propGeometry';

/** How a tree tier reacts when the jeep hits it. */
export interface TreeTierDef {
  /** always: snaps at any real impact; energy: above `breakEnergy`; never: solid. */
  breaks: 'always' | 'energy' | 'never';
  /** Impact speed (m/s) below which nothing happens (the jeep just bumps). */
  minSpeed: number;
  /** Kinetic energy of the impact (J, ½·m·v²) needed to snap an 'energy' tree. */
  breakEnergy: number;
  /** Fraction of the jeep's speed lost when it snaps the tree (robustness). */
  speedLoss: number;
  /** Dynamic pieces thrown (crown/trunk/logs), 1..3. */
  pieces: number;
  /** Camera shake and style points. */
  shake: number;
  score: number;
}

/**
 * Destructible trees: young ones always break, medium ones only above an energy threshold
 * (≈ 30 km/h for a 1.65 t jeep), old ones never.
 */
export const treeTiers: Record<TreeTier, TreeTierDef> = {
  young: {
    breaks: 'always',
    minSpeed: 1.5,
    breakEnergy: 0,
    speedLoss: 0.07,
    pieces: 1,
    shake: 0.15,
    score: 120,
  },
  medium: {
    breaks: 'energy',
    minSpeed: 3,
    breakEnergy: 45000,
    speedLoss: 0.24,
    pieces: 2,
    shake: 0.32,
    score: 260,
  },
  old: {
    breaks: 'never',
    minSpeed: Infinity,
    breakEnergy: Infinity,
    speedLoss: 0,
    pieces: 0,
    shake: 0,
    score: 0,
  },
};

/** Whether a hit at `impactSpeed` (m/s, along the contact normal) by `mass` kg snaps the tree. */
export function treeBreaks(tier: TreeTier, mass: number, impactSpeed: number): boolean {
  const d = treeTiers[tier];
  if (d.breaks === 'never' || impactSpeed < d.minSpeed) return false;
  if (d.breaks === 'always') return true;
  return 0.5 * mass * impactSpeed * impactSpeed >= d.breakEnergy;
}
