import type { ModeDef, ModeId } from './types';

/** Game modes. A mode is a list of gameplay systems (plugins) to activate. */
export const modes: Record<ModeId, ModeDef> = {
  freeDescent: {
    id: 'freeDescent',
    nameKey: 'mode.freeDescent.name',
    descriptionKey: 'mode.freeDescent.desc',
    systems: ['nitro', 'style', 'hazards', 'collectibles', 'trees', 'medals', 'achievements'],
    recordsEnabled: true,
    medalsBy: 'score',
  },
  daily: {
    id: 'daily',
    nameKey: 'mode.daily.name',
    descriptionKey: 'mode.daily.desc',
    systems: [
      'nitro',
      'style',
      'hazards',
      'collectibles',
      'trees',
      'objectives',
      'medals',
      'achievements',
    ],
    recordsEnabled: true,
    medalsBy: 'objectives',
  },
};
