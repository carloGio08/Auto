import type { UpgradeDef } from './types';

/** Garage upgrades. Each level multiplies some physics parameters of the selected car. */
export const upgrades: UpgradeDef[] = [
  {
    id: 'engine',
    nameKey: 'upgrade.engine.name',
    descriptionKey: 'upgrade.engine.desc',
    costs: [300, 700, 1400],
    apply(p, level) {
      p.engine.power *= 1 + 0.08 * level;
      p.engine.maxForce *= 1 + 0.05 * level;
    },
  },
  {
    id: 'grip',
    nameKey: 'upgrade.grip.name',
    descriptionKey: 'upgrade.grip.desc',
    costs: [250, 600, 1200],
    apply(p, level) {
      p.tires.grip *= 1 + 0.045 * level;
    },
  },
  {
    id: 'suspension',
    nameKey: 'upgrade.suspension.name',
    descriptionKey: 'upgrade.suspension.desc',
    costs: [250, 550, 1100],
    apply(p, level) {
      p.suspension.maxTravel *= 1 + 0.07 * level;
      p.suspension.dampingBump *= 1 + 0.06 * level;
      p.suspension.dampingRebound *= 1 + 0.06 * level;
      p.airControl *= 1 + 0.06 * level;
    },
  },
  {
    id: 'nitro',
    nameKey: 'upgrade.nitro.name',
    descriptionKey: 'upgrade.nitro.desc',
    costs: [200, 500, 1000],
    apply(p, level) {
      p.nitro.force *= 1 + 0.08 * level;
      p.nitro.burnRate *= 1 - 0.07 * level;
    },
  },
];

export const MAX_UPGRADE_LEVEL = 3;
