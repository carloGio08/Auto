import type { ModeDef, ModeId } from './types';

/** Game modes. A mode is a list of gameplay systems (plugins) to activate. */
export const modes: Record<ModeId, ModeDef> = {
  timeAttack: {
    id: 'timeAttack',
    nameKey: 'mode.timeAttack.name',
    descriptionKey: 'mode.timeAttack.desc',
    systems: [
      'checkpoints',
      'nitro',
      'style',
      'hazards',
      'collectibles',
      'ghost',
      'medals',
      'achievements',
    ],
    timed: true,
    recordsEnabled: true,
  },
  freeRide: {
    id: 'freeRide',
    nameKey: 'mode.freeRide.name',
    descriptionKey: 'mode.freeRide.desc',
    systems: ['checkpoints', 'nitro', 'style', 'hazards', 'collectibles', 'achievements'],
    timed: false,
    recordsEnabled: false,
  },
  daily: {
    id: 'daily',
    nameKey: 'mode.daily.name',
    descriptionKey: 'mode.daily.desc',
    systems: [
      'checkpoints',
      'nitro',
      'style',
      'hazards',
      'collectibles',
      'ghost',
      'medals',
      'achievements',
    ],
    timed: true,
    recordsEnabled: true,
  },
};
