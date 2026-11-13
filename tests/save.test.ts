import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA,
  MemoryStorage,
  SAVE_KEY,
  SaveManager,
  defaultSave,
  migrate,
} from '../src/core/save';

describe('save system', () => {
  it('starts from defaults when storage is empty', () => {
    const m = new SaveManager(new MemoryStorage());
    expect(m.data).toEqual(defaultSave());
  });

  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const a = new SaveManager(storage);
    a.data.coins = 1234;
    a.data.ownedCars.push('hopper');
    a.flush();
    const b = new SaveManager(storage);
    expect(b.data.coins).toBe(1234);
    expect(b.data.ownedCars).toContain('hopper');
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
    expect(data.selectedCar).toBe('sidewinder');
    expect(data.ownedCars).toEqual(expect.arrayContaining(['ridge', 'sidewinder']));
    expect(data.records['pine_ridge:timeAttack'].bestTime).toBe(81.5); // dropped by the v4 migration
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
    expect(bad.ownedCars).toEqual(['ridge']);
    expect(bad.selectedCar).toBe('ridge');
    expect(migrate({ schemaVersion: 999 }).schemaVersion).toBe(CURRENT_SCHEMA);
  });

  it('keeps only the latest daily-challenge ghost', () => {
    const storage = new MemoryStorage();
    const m = new SaveManager(storage);
    m.saveGhost('pine_ridge', 'a');
    m.saveGhost('daily_2026-11-12', 'b');
    m.saveGhost('daily_2026-11-13', 'c');
    expect(m.loadGhost('pine_ridge')).toBe('a');
    expect(m.loadGhost('daily_2026-11-12')).toBeNull();
    expect(m.loadGhost('daily_2026-11-13')).toBe('c');
    m.reset();
    expect(m.loadGhost('pine_ridge')).toBeNull();
  });
});
