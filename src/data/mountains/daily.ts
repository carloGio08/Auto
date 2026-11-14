import { Rng, hashString } from '../../math/rng';
import type { HazardKind, MountainDef, TimeOfDayId, WeatherId } from '../types';
import { alpine } from './alpine';
import { dailyObjectives } from '../objectives';
import { variantOf } from './variants';

/** Returns the local date as YYYY-MM-DD, used as the daily challenge seed. */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Builds the daily challenge mountain from a date string: the main massif's landforms,
 * mirrored or not, moved and reshaped from the date's seed, with its own relief, terraces,
 * biomes, time of day and weather. Everyone playing on the same day gets the same mountain.
 */
export function createDailyMountain(dateKey: string): MountainDef {
  const seed = hashString(`mountain-drop:${dateKey}`);
  const rng = new Rng(seed);
  const times: TimeOfDayId[] = ['dawn', 'day', 'sunset', 'night'];
  const weathers: WeatherId[] = ['clear', 'clear', 'fog', 'snow'];
  const kinds: HazardKind[] = ['boulder', 'rockslide', 'mudPool', 'icePatch'];
  const shape = variantOf(alpine, {
    seed,
    mirror: rng.chance(0.5),
    jitter: rng.range(100, 220),
    relief: rng.range(0.85, 1.1),
    rugged: rng.range(0.8, 1.2),
  });
  const height = rng.range(1610, 1700);
  return {
    ...shape,
    id: `daily_${dateKey}`,
    nameKey: 'mountain.daily.name',
    descriptionKey: 'mountain.daily.desc',
    summit: { ...shape.summit, height },
    terracing: { amount: rng.range(0.4, 0.7), scale: rng.range(1100, 1700) },
    noise: {
      ...shape.noise,
      warp: rng.range(160, 240),
      warpScale: rng.range(2300, 2900),
      broad: { amplitude: rng.range(28, 45), scale: rng.range(1300, 1800) },
    },
    biomes: {
      snowLine: height - rng.range(250, 380),
      rockLine: height - rng.range(420, 560),
      treeLine: height - rng.range(600, 720),
      denseForestLine: rng.range(480, 620),
      valleyLine: 180,
    },
    props: { trees: rng.range(0.7, 1.1), rocks: rng.range(0.7, 1.3), bushes: rng.range(0.6, 1) },
    hazards: Array.from({ length: 6 }, (_, i) => ({
      kind: rng.pick(kinds),
      at: +(0.08 + i * 0.15 + rng.next() * 0.05).toFixed(3),
    })),
    collectibles: { coins: 160, crystals: 10 },
    defaultTime: rng.pick(times),
    defaultWeather: rng.pick(weathers),
    medals: { gold: 55000, silver: 30000, bronze: 11000 },
    unlockAfter: undefined,
    objectives: dailyObjectives(seed),
  };
}
