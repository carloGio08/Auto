import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA,
  MemoryStorage,
  SAVE_KEY,
  STARTER_CAR,
  SaveManager,
  defaultSave,
  defaultStats,
  migrate,
} from '../src/core/save';
import { cars } from '../src/data/cars';

describe('save system', () => {
  it('starts from defaults when storage is empty', () => {
    const m = new SaveManager(new MemoryStorage());
    expect(m.data).toEqual(defaultSave());
  });

  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const a = new SaveManager(storage);
    a.data.coins = 1234;
    a.data.ownedCars.push('scout');
    a.flush();
    const b = new SaveManager(storage);
    expect(b.data.coins).toBe(1234);
    expect(b.data.ownedCars).toContain('scout');
  });

  it('migrates a v1 prototype save to the current schema', () => {
    const v1 = {
      version: 1,
      coins: 500,
      car: 'sidewinder',
      best: { pine_ridge: 81.5 },
      volume: 0.3,
    };
    const data = migrate(v1);
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(data.coins).toBe(500);
    expect(data.selectedCar).toBe('scout');
    expect(data.ownedCars).toEqual(expect.arrayContaining([STARTER_CAR, 'scout']));
    expect(data.records).toEqual({}); // time records are dropped by the v4 migration
    expect(data.settings.masterVolume).toBe(0.3);
    expect(data.stats.runsFinished).toBe(0);
    expect(data.daily.date).toBe('');
  });

  it('migrates v2 and keeps existing fields', () => {
    const v2 = {
      schemaVersion: 2,
      coins: 10,
      selectedCar: 'ridge',
      ownedCars: ['ridge'],
      records: {},
      achievements: ['first_drop'],
      settings: { language: 'it' },
    };
    const data = migrate(v2);
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(data.achievements).toEqual(['first_drop']);
    expect(data.settings.language).toBe('it');
    expect(data.settings.quality).toBe('auto');
  });

  it('v3 → v4 keeps coins, unlocks, upgrades and settings, drops times and medals', () => {
    const v3 = {
      schemaVersion: 3,
      coins: 4321,
      selectedCar: 'avalanche',
      ownedCars: ['ridge', 'hopper', 'sidewinder', 'avalanche'],
      carColors: { ridge: '#ff0000' },
      upgrades: {
        ridge: { engine: 2, grip: 1 },
        hopper: { engine: 1, nitro: 3 },
        sidewinder: { engine: 3 },
      },
      records: {
        'pine_ridge:timeAttack': { bestTime: 75.2, bestScore: 900, medal: 'gold', runs: 4 },
      },
      achievements: ['first_drop', 'gold_rush'],
      stats: { ...defaultStats(), runsFinished: 12, goldMedals: 3, totalCoins: 800 },
      settings: { ...defaultSave().settings, language: 'it', masterVolume: 0.4 },
      lastMountain: 'pine_ridge',
      lastTime: 'dusk',
      lastWeather: 'clear',
      daily: { date: '2026-11-01', bestScore: 1200, medal: 'silver' },
      seenTutorial: true,
    };
    const data = migrate(v3);
    expect(data.schemaVersion).toBe(4);
    expect(data.coins).toBe(4321);
    expect(data.selectedCar).toBe('crawler');
    expect(new Set(data.ownedCars)).toEqual(new Set(['trailblazer', 'scout', 'crawler']));
    expect(data.upgrades.trailblazer).toEqual({ engine: 2, grip: 1 });
    expect(data.upgrades.scout).toEqual({ engine: 3, nitro: 3 });
    expect(data.achievements).toEqual(['first_drop', 'gold_rush']);
    expect(data.stats.runsFinished).toBe(12);
    expect(data.stats.totalCoins).toBe(800);
    expect(data.stats.goldMedals).toBe(0);
    expect(data.settings.language).toBe('it');
    expect(data.settings.masterVolume).toBe(0.4);
    expect(data.records).toEqual({});
    expect(data.daily).toEqual({ date: '', bestScore: 0, medal: 'none' });
    expect(data.carColors).toEqual({});
    expect(data.lastMountain).toBe('alpine');
    expect(data.seenTutorial).toBe(true);
    for (const id of data.ownedCars) expect(cars.some((c) => c.id === id)).toBe(true);
  });

  it('purges the legacy replay ghosts when loading an old save', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 3, coins: 5 }));
    storage.setItem('mountain-drop:ghost:__index', JSON.stringify(['pine_ridge']));
    storage.setItem('mountain-drop:ghost:pine_ridge', 'xyz');
    const m = new SaveManager(storage);
    expect(m.data.coins).toBe(5);
    expect(storage.getItem('mountain-drop:ghost:pine_ridge')).toBeNull();
    expect(storage.getItem('mountain-drop:ghost:__index')).toBeNull();
  });

  it('recovers from corrupted or hostile data', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(new SaveManager(storage).data).toEqual(defaultSave());
    const bad = migrate({
      schemaVersion: CURRENT_SCHEMA,
      coins: -50,
      ownedCars: [],
      selectedCar: 'nope',
    });
    expect(bad.coins).toBe(0);
    expect(bad.ownedCars).toEqual([STARTER_CAR]);
    expect(bad.selectedCar).toBe(STARTER_CAR);
    expect(migrate({ schemaVersion: 999 }).schemaVersion).toBe(CURRENT_SCHEMA);
  });
});
