import { Rng, hashString } from '../../math/rng';
import type { SurfaceId, TimeOfDayId, TrackDef, WeatherId, HazardKind } from '../types';

/** Returns the local date as YYYY-MM-DD, used as the daily challenge seed. */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Procedurally builds the daily challenge track from a date string. Everyone playing on the
 * same day gets the same mountain, layout, weather and medal times.
 */
export function createDailyTrack(dateKey: string): TrackDef {
  const seed = hashString(`mountain-drop:${dateKey}`);
  const rng = new Rng(seed);
  const legs = rng.int(5, 7);
  const roadSurface = rng.pick<SurfaceId>(['dirt', 'gravel', 'dirt', 'snow']);
  const times: TimeOfDayId[] = ['dawn', 'day', 'sunset', 'night'];
  const weatherPool: WeatherId[] = ['clear', 'clear', 'fog', 'snow'];
  const zoneSurfaces: SurfaceId[] = ['ice', 'mud', 'gravel', 'snow', 'rock'];
  const hazardKinds: HazardKind[] = ['boulder', 'log', 'rockslide', 'mudPool', 'icePatch'];

  const checkpoints: number[] = [];
  const cpCount = legs - 1;
  for (let i = 1; i <= cpCount; i++) checkpoints.push(+(i / (cpCount + 1)).toFixed(3));

  const jumps = Array.from({ length: rng.int(3, 5) }, (_, i) => ({
    at: +(0.12 + (i + rng.next() * 0.6) * (0.8 / 5)).toFixed(3),
    height: +rng.range(1.5, 3).toFixed(2),
    length: Math.round(rng.range(16, 24)),
  }));

  const surfaces = Array.from({ length: rng.int(2, 3) }, (_, i) => {
    const from = 0.08 + i * 0.3 + rng.next() * 0.12;
    return {
      from: +from.toFixed(3),
      to: +(from + rng.range(0.04, 0.08)).toFixed(3),
      surface: rng.pick(zoneSurfaces),
    };
  });

  const hazards = Array.from({ length: rng.int(3, 5) }, (_, i) => ({
    kind: rng.pick(hazardKinds),
    at: +(0.15 + i * 0.17 + rng.next() * 0.05).toFixed(3),
  }));

  const shortcuts = Array.from({ length: 2 }, (_, i) => {
    const from = 0.15 + i * 0.4 + rng.next() * 0.1;
    return {
      from: +from.toFixed(3),
      to: +(from + 0.1).toFixed(3),
      surface: rng.pick(zoneSurfaces),
      kickers: rng.int(1, 2),
    };
  });

  const slope = rng.range(0.33, 0.4);
  const estimatedLength = legs * 240 + 160;
  const par = estimatedLength / 17.5;
  const bronze = Math.round(par * 1.3);
  const startTime = 34;
  // Enough total time for a bronze run plus a margin.
  const checkpointBonus = Math.ceil((bronze * 1.15 - startTime) / Math.max(1, cpCount));

  return {
    id: `daily_${dateKey}`,
    nameKey: 'track.daily.name',
    descriptionKey: 'track.daily.desc',
    difficulty: 2,
    seed,
    layout: {
      kind: 'switchback',
      legs,
      legLength: [170, 240],
      legHeading: rng.range(60, 67),
      hairpinRadius: rng.range(15, 19),
      wiggle: rng.range(10, 22),
      runIn: 60,
      runOut: 110,
      firstDirection: rng.chance(0.5) ? 1 : -1,
    },
    roadWidth: rng.range(9.5, 11),
    terrain: {
      summitHeight: 300 + legs * 30,
      slope,
      ridgeAmplitude: rng.range(30, 60),
      noiseAmplitude: rng.range(12, 20),
      snowLine: rng.range(240, 340),
      lakeLevel: 50,
      lakeRadius: 240,
    },
    river: { x: rng.pick([-1, 1]) * rng.range(40, 70), from: 0.7, width: 9, depth: 7, meander: 26 },
    roadSurface,
    surfaces,
    jumps,
    bumps: [{ from: 0.6, to: 0.64, amplitude: 0.4 }],
    arch: +rng.range(0.25, 0.7).toFixed(3),
    shortcuts,
    checkpoints,
    hazards,
    collectibles: { coins: 60 + legs * 4, crystals: 6 },
    props: { trees: rng.range(0.6, 1), rocks: rng.range(0.6, 1), bushes: rng.range(0.5, 1) },
    defaultTime: rng.pick(times),
    defaultWeather: rng.pick(weatherPool),
    startTime,
    checkpointBonus,
    medals: { gold: Math.round(par), silver: Math.round(par * 1.14), bronze },
  };
}
