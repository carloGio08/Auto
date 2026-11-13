import type { AchievementStats, TimeOfDayId, UpgradeId, WeatherId } from '../data/types';
import { defaultSettings, type Settings } from './settings';

export const SAVE_KEY = 'mountain-drop:save';
export const GHOST_PREFIX = 'mountain-drop:ghost:';
export const CURRENT_SCHEMA = 3;

export type MedalId = 'none' | 'bronze' | 'silver' | 'gold';

export interface TrackRecord {
  bestTime: number | null;
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
  /** Keyed by `${trackId}:${modeId}`. */
  records: Record<string, TrackRecord>;
  achievements: string[];
  stats: AchievementStats;
  settings: Settings;
  lastTrack: string;
  lastTime: TimeOfDayId | 'default';
  lastWeather: WeatherId | 'default';
  daily: { date: string; bestTime: number | null; medal: MedalId };
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
    selectedCar: 'ridge',
    ownedCars: ['ridge'],
    carColors: {},
    upgrades: {},
    records: {},
    achievements: [],
    stats: defaultStats(),
    settings: defaultSettings(),
    lastTrack: 'pine_ridge',
    lastTime: 'default',
    lastWeather: 'default',
    daily: { date: '', bestTime: null, medal: 'none' },
    seenTutorial: false,
  };
}

type AnySave = Record<string, unknown>;

/**
 * Migrations from version N to N+1. Each function receives the raw object of version N.
 * Never edit an existing migration: add a new one and bump CURRENT_SCHEMA.
 */
export const migrations: Record<number, (old: AnySave) => AnySave> = {
  // v1 (prototype): { version: 1, coins, car, best: { [trackId]: seconds }, volume }
  1: (old) => {
    const best = (old.best as Record<string, number> | undefined) ?? {};
    const records: Record<string, TrackRecord> = {};
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
    daily: { date: '', bestTime: null, medal: 'none' },
    seenTutorial: false,
  }),
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
    merged.ownedCars = ['ridge'];
  if (!merged.ownedCars.includes(merged.selectedCar)) merged.selectedCar = merged.ownedCars[0];
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
      return migrate(JSON.parse(raw) as AnySave);
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
    for (const key of this.ghostKeys()) this.storage.removeItem(key);
  }

  record(trackId: string, modeId: string): TrackRecord {
    const key = `${trackId}:${modeId}`;
    return (this.data.records[key] ??= { bestTime: null, bestScore: 0, medal: 'none', runs: 0 });
  }

  upgradeLevel(carId: string, upgrade: UpgradeId): number {
    return this.data.upgrades[carId]?.[upgrade] ?? 0;
  }

  saveGhost(trackId: string, encoded: string): void {
    try {
      this.storage.setItem(GHOST_PREFIX + trackId, encoded);
      const index = this.ghostIndex;
      // Daily challenge ghosts expire: keep only the current day's one.
      if (trackId.startsWith('daily_')) {
        for (const id of [...index]) {
          if (id.startsWith('daily_') && id !== trackId) {
            this.storage.removeItem(GHOST_PREFIX + id);
            index.delete(id);
          }
        }
      }
      index.add(trackId);
      this.storage.setItem(GHOST_PREFIX + '__index', JSON.stringify([...index]));
    } catch (err) {
      console.warn('Could not store ghost', err);
    }
  }

  loadGhost(trackId: string): string | null {
    return this.storage.getItem(GHOST_PREFIX + trackId);
  }

  private get ghostIndex(): Set<string> {
    try {
      return new Set(
        JSON.parse(this.storage.getItem(GHOST_PREFIX + '__index') ?? '[]') as string[],
      );
    } catch {
      return new Set();
    }
  }

  private ghostKeys(): string[] {
    return [...this.ghostIndex].map((id) => GHOST_PREFIX + id).concat(GHOST_PREFIX + '__index');
  }
}
