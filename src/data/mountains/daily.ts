import { Rng, hashString } from '../../math/rng';
import type { HazardKind, MountainDef, TimeOfDayId, WeatherId } from '../types';
import { alpine } from './alpine';
import { dailyObjectives } from '../objectives';

/** Returns the local date as YYYY-MM-DD, used as the daily challenge seed. */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Builds the daily challenge mountain from a date string: same overall structure as the main
 * massif but a different seed, shape, trail route, time of day and weather. Everyone playing
 * on the same day gets the same mountain.
 */
export function createDailyMountain(dateKey: string): MountainDef {
  const seed = hashString(`mountain-drop:${dateKey}`);
  const rng = new Rng(seed);
  const times: TimeOfDayId[] = ['dawn', 'day', 'sunset', 'night'];
  const weathers: WeatherId[] = ['clear', 'clear', 'fog', 'snow'];
  const kinds: HazardKind[] = ['boulder', 'rockslide', 'mudPool', 'icePatch'];
  const summitX = rng.range(-400, 400);
  const summitZ = rng.range(-1400, -1100);
  const baseX = rng.range(-500, 500);
  const height = rng.range(1600, 1950);
  // Main trail: alternate sides of the mountain on the way down.
  const legs = rng.int(4, 6);
  const side = rng.chance(0.5) ? 1 : -1;
  const waypoints: [number, number][] = [[summitX, summitZ + 110]];
  for (let i = 1; i < legs; i++) {
    const f = i / legs;
    waypoints.push([
      side * (i % 2 ? 1 : -1) * rng.range(450, 800),
      summitZ + 110 + f * (2230 - summitZ - 110),
    ]);
  }
  waypoints.push([baseX, 2230]);
  return {
    ...alpine,
    id: `daily_${dateKey}`,
    nameKey: 'mountain.daily.name',
    descriptionKey: 'mountain.daily.desc',
    seed,
    summit: { x: summitX, z: summitZ, height, plateauRadius: 130 },
    radii: {
      north: rng.range(3300, 3700),
      south: 3900,
      east: rng.range(3500, 3900),
      west: rng.range(3500, 3900),
    },
    spurs: { count: rng.int(4, 7), amplitude: rng.range(70, 100), twist: rng.range(-0.9, 0.9) },
    noise: {
      warp: rng.range(220, 320),
      warpScale: rng.range(2200, 2900),
      low: { amplitude: rng.range(45, 65), scale: rng.range(1500, 1900) },
      mid: { amplitude: rng.range(12, 20), scale: rng.range(450, 560) },
    },
    cliffs: [
      {
        x: rng.range(1300, 2000),
        z: rng.range(-1200, 600),
        angle: rng.range(-1, 1),
        length: 450,
        height: 30,
        width: 9,
      },
      {
        x: rng.range(-2000, -1300),
        z: rng.range(-1200, 600),
        angle: rng.range(-1, 1),
        length: 400,
        height: 28,
        width: 8,
      },
    ],
    lake: { x: baseX, z: 2850, radius: 500, level: 36 },
    rivers: [
      {
        spring: [rng.range(900, 1500) * (rng.chance(0.5) ? 1 : -1), rng.range(0, 700)],
        width: 6.5,
        depth: 2.8,
      },
    ],
    biomes: {
      snowLine: height - rng.range(300, 450),
      rockLine: height - rng.range(560, 700),
      treeLine: height - rng.range(780, 900),
      denseForestLine: rng.range(450, 600),
      valleyLine: 170,
    },
    trails: [
      { id: 'main', kind: 'main', waypoints, width: [7, 10], targetGrade: 0.17, maxGrade: 0.26 },
    ],
    base: { x: baseX, z: 2230, radius: 120 },
    start: { x: summitX, z: summitZ + 110 },
    props: { trees: rng.range(0.7, 1.1), rocks: rng.range(0.7, 1.3), bushes: rng.range(0.6, 1) },
    hazards: Array.from({ length: 6 }, (_, i) => ({
      kind: rng.pick(kinds),
      at: +(0.08 + i * 0.15 + rng.next() * 0.05).toFixed(3),
    })),
    collectibles: { coins: 150, crystals: 10 },
    defaultTime: rng.pick(times),
    defaultWeather: rng.pick(weathers),
    medals: { gold: 55000, silver: 30000, bronze: 11000 },
    unlockAfter: undefined,
    objectives: dailyObjectives(seed),
  };
}
