import type { AchievementStats, TimeOfDayId, UpgradeId, WeatherId } from '../data/types';
import { CAMERA_MODES, defaultSettings, type Settings } from './settings';

export const SAVE_KEY = 'mountain-drop:save';
/** Storage prefix of the replay ghosts used up to schema v3 (purged on load). */
const LEGACY_GHOST_PREFIX = 'mountain-drop:ghost:';
export const CURRENT_SCHEMA = 4;
export const STARTER_CAR = 'trailblazer';

/** v3 car ids → v4 jeeps. */
const LEGACY_CARS: Record<string, string> = {
  ridge: 'trailblazer',
  sidewinder: 'scout',
  hopper: 'scout',
  avalanche: 'crawler',
};

export type MedalId = 'none' | 'bronze' | 'silver' | 'gold';

export interface TrackRecord {
  bestScore: number;
  medal: MedalId;
  runs: number;
}

export interface SaveData {
  schemaVersion: number;
  coins: number;
  selectedCar: string;
  ownedCars: string[];
  carColors: Record<string, string>;
  upgrades: Record<string, Partial<Record<UpgradeId, number>>>;
  /** Keyed by `${mountainId}:${modeId}`. */
  records: Record<string, TrackRecord>;
  achievements: string[];
  stats: AchievementStats;
  settings: Settings;
  lastMountain: string;
  lastTime: TimeOfDayId | 'default';
  lastWeather: WeatherId | 'default';
  daily: { date: string; bestScore: number; medal: MedalId };
  /** True once the player has seen the controls tutorial overlay. */
  seenTutorial: boolean;
}

export function defaultStats(): AchievementStats {
  return {
    runsFinished: 0,
    totalDistance: 0,
    bestAirTime: 0,
    totalFlips: 0,
    totalCoins: 0,
    bestCombo: 0,
    longestDrift: 0,
    goldMedals: 0,
    nearMisses: 0,
    crystals: 0,
  };
}

export function defaultSave(): SaveData {
  return {
    schemaVersion: CURRENT_SCHEMA,
    coins: 0,
    selectedCar: STARTER_CAR,
    ownedCars: [STARTER_CAR],
    carColors: {},
    upgrades: {},
    records: {},
    achievements: [],
    stats: defaultStats(),
    settings: defaultSettings(),
    lastMountain: 'alpine',
    lastTime: 'default',
    lastWeather: 'default',
    daily: { date: '', bestScore: 0, medal: 'none' },
    seenTutorial: false,
  };
}

type AnySave = Record<string, unknown>;

/**
 * Migrations from version N to N+1. Each function receives the raw object of version N.
 * Never edit an existing migration: add a new one and bump CURRENT_SCHEMA.
 */
export const migrations: Record<number, (old: AnySave) => AnySave> = {
  // v1 (prototype): { version: 1, coins, car, best: { [mountainId]: seconds }, volume }
  1: (old) => {
    const best = (old.best as Record<string, number> | undefined) ?? {};
    const records: Record<string, object> = {};
    for (const [track, time] of Object.entries(best)) {
      records[`${track}:timeAttack`] = {
        bestTime: typeof time === 'number' ? time : null,
        bestScore: 0,
        medal: 'none',
        runs: 1,
      };
    }
    const settings = defaultSettings();
    if (typeof old.volume === 'number') settings.masterVolume = old.volume;
    const car = typeof old.car === 'string' ? old.car : 'ridge';
    return {
      schemaVersion: 2,
      coins: typeof old.coins === 'number' ? old.coins : 0,
      selectedCar: car,
      ownedCars: Array.from(new Set(['ridge', car])),
      upgrades: {},
      records,
      achievements: [],
      settings,
    };
  },
  // v2 → v3: added stats, car colours, daily challenge and tutorial flag.
  2: (old) => ({
    ...old,
    schemaVersion: 3,
    stats: { ...defaultStats(), ...((old.stats as object) ?? {}) },
    carColors: old.carColors ?? {},
    daily: { date: '', bestScore: 0, medal: 'none' },
    seenTutorial: false,
  }),
  // v3 → v4 (free-roam jeep update): keeps coins, unlocks, upgrades, achievements, stats and
  // settings; maps the old cars onto the new jeeps; drops time records, medals and the daily
  // result (the scoring changed), and the paint choices of cars that no longer exist.
  3: (old) => {
    const map = (id: unknown): string =>
      typeof id === 'string' ? (LEGACY_CARS[id] ?? id) : STARTER_CAR;
    const owned = Array.isArray(old.ownedCars) ? old.ownedCars.map(map) : [STARTER_CAR];
    const upgrades: Record<string, Record<string, number>> = {};
    const oldUpgrades = (old.upgrades as Record<string, Record<string, number>>) ?? {};
    for (const [car, levels] of Object.entries(oldUpgrades)) {
      const target = (upgrades[map(car)] ??= {});
      for (const [u, l] of Object.entries(levels ?? {}))
        if (typeof l === 'number') target[u] = Math.max(target[u] ?? 0, l);
    }
    const stats = { ...defaultStats(), ...((old.stats as object) ?? {}) };
    stats.goldMedals = 0;
    return {
      ...old,
      schemaVersion: 4,
      selectedCar: map(old.selectedCar),
      ownedCars: Array.from(new Set([STARTER_CAR, ...owned])),
      upgrades,
      carColors: {},
      records: {},
      stats,
      daily: { date: '', bestScore: 0, medal: 'none' },
      lastMountain: 'alpine',
    };
  },
};

/** Applies migrations in order and fills any missing field with defaults. */
export function migrate(raw: AnySave): SaveData {
  let data: AnySave = { ...raw };
  let version =
    typeof data.schemaVersion === 'number'
      ? data.schemaVersion
      : typeof data.version === 'number'
        ? data.version
        : 0;
  if (version === 0) return defaultSave();
  while (version < CURRENT_SCHEMA) {
    const m = migrations[version];
    if (!m) return defaultSave();
    data = m(data);
    version = data.schemaVersion as number;
  }
  const def = defaultSave();
  const merged: SaveData = {
    ...def,
    ...(data as Partial<SaveData>),
    schemaVersion: CURRENT_SCHEMA,
    stats: { ...def.stats, ...((data.stats as Partial<AchievementStats>) ?? {}) },
    settings: { ...def.settings, ...((data.settings as Partial<Settings>) ?? {}) },
    daily: { ...def.daily, ...((data.daily as object) ?? {}) },
  };
  if (!Array.isArray(merged.ownedCars) || merged.ownedCars.length === 0)
    merged.ownedCars = [STARTER_CAR];
  if (!merged.ownedCars.includes(merged.selectedCar)) merged.selectedCar = merged.ownedCars[0];
  if (!CAMERA_MODES.includes(merged.settings.camera))
    merged.settings.camera = (merged.settings.camera as string) === 'high' ? 'wide' : 'chase';
  if (typeof merged.coins !== 'number' || !Number.isFinite(merged.coins) || merged.coins < 0)
    merged.coins = 0;
  return merged;
}

/** Minimal storage interface so tests can inject an in-memory implementation. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function safeStorage(): KeyValueStorage {
  try {
    const s = window.localStorage;
    const probe = '__md_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return new MemoryStorage();
  }
}

/** Versioned persistence of progress and settings. */
export class SaveManager {
  data: SaveData;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storage: KeyValueStorage = safeStorage()) {
    this.data = this.load();
  }

  load(): SaveData {
    const raw = this.storage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    try {
      const data = JSON.parse(raw) as AnySave;
      if (typeof data.schemaVersion === 'number' && data.schemaVersion < 4) this.purgeGhosts();
      return migrate(data);
    } catch (err) {
      console.warn('Corrupted save, starting fresh', err);
      return defaultSave();
    }
  }

  /** Writes soon (debounced) – call after any change. */
  save(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (err) {
      console.warn('Could not write save', err);
    }
  }

  reset(): void {
    this.data = defaultSave();
    this.flush();
    this.purgeGhosts();
  }

  record(mountainId: string, modeId: string): TrackRecord {
    const key = `${mountainId}:${modeId}`;
    return (this.data.records[key] ??= { bestScore: 0, medal: 'none', runs: 0 });
  }

  upgradeLevel(carId: string, upgrade: UpgradeId): number {
    return this.data.upgrades[carId]?.[upgrade] ?? 0;
  }

  /** Removes the replay ghosts stored by schema v3 and earlier. */
  private purgeGhosts(): void {
    let ids: string[] = [];
    try {
      ids = JSON.parse(this.storage.getItem(LEGACY_GHOST_PREFIX + '__index') ?? '[]') as string[];
    } catch {
      /* ignore */
    }
    for (const id of ids) this.storage.removeItem(LEGACY_GHOST_PREFIX + id);
    this.storage.removeItem(LEGACY_GHOST_PREFIX + '__index');
  }
}
