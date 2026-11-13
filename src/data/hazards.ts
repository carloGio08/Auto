import type { HazardDef, HazardKind } from './types';

export const hazards: Record<HazardKind, HazardDef> = {
  boulder: { kind: 'boulder', nameKey: 'hazard.boulder', triggerDistance: 140, radius: 1.7 },
  rockslide: { kind: 'rockslide', nameKey: 'hazard.rockslide', triggerDistance: 120, radius: 0.9 },
  log: { kind: 'log', nameKey: 'hazard.log', triggerDistance: 0, radius: 0.45 },
  mudPool: {
    kind: 'mudPool',
    nameKey: 'hazard.mudPool',
    triggerDistance: 0,
    radius: 7,
    surface: 'mud',
  },
  icePatch: {
    kind: 'icePatch',
    nameKey: 'hazard.icePatch',
    triggerDistance: 0,
    radius: 9,
    surface: 'ice',
  },
};
