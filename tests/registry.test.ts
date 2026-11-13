import { describe, expect, it } from 'vitest';
import { createRegistries, Registry } from '../src/data/registry';
import { en } from '../src/i18n/en';
import { it as itDict } from '../src/i18n/it';
import { systemFactories } from '../src/systems';
import { surfaces } from '../src/data/surfaces';
import { createDailyTrack } from '../src/data/tracks';

const reg = createRegistries();
const hasKey = (k: string): boolean => k in en;

describe('content registries', () => {
  it('rejects duplicate ids and unknown lookups', () => {
    const r = new Registry('thing', [{ id: 'a' }]);
    expect(() => r.register({ id: 'a' })).toThrow();
    expect(() => r.get('b')).toThrow();
  });

  it.each(reg.cars.all().map((c) => [c.id, c] as const))(
    'car %s has every required field',
    (_id, car) => {
      expect(hasKey(car.nameKey)).toBe(true);
      expect(hasKey(car.descriptionKey)).toBe(true);
      expect(car.price).toBeGreaterThanOrEqual(0);
      const p = car.physics;
      for (const v of [
        p.mass,
        p.wheelbase,
        p.trackWidth,
        p.wheelRadius,
        p.suspension.restLength,
        p.suspension.maxTravel,
        p.suspension.stiffness,
        p.tires.grip,
        p.engine.power,
        p.engine.maxForce,
        p.aero.drag,
        p.steering.maxAngle,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      expect(p.suspension.maxTravel).toBeLessThan(p.suspension.restLength + p.wheelRadius);
      expect(car.look.colors.length).toBeGreaterThan(0);
      if (car.requiresAchievement) expect(reg.achievements.has(car.requiresAchievement)).toBe(true);
      for (const s of Object.values(car.stats)) expect(s).toBeGreaterThanOrEqual(0);
    },
  );

  it('has exactly one free starter car', () => {
    expect(reg.cars.all().filter((c) => c.price === 0)).toHaveLength(1);
  });

  it.each([...reg.tracks.all(), createDailyTrack('2026-11-13')].map((t) => [t.id, t] as const))(
    'track %s has every required field',
    (_id, t) => {
      expect(hasKey(t.nameKey)).toBe(true);
      expect(hasKey(t.descriptionKey)).toBe(true);
      expect(t.medals.gold).toBeLessThan(t.medals.silver);
      expect(t.medals.silver).toBeLessThan(t.medals.bronze);
      // The time budget must allow a bronze run.
      expect(t.startTime + t.checkpointBonus * t.checkpoints.length).toBeGreaterThan(
        t.medals.bronze,
      );
      expect(t.surfaces.every((z) => z.surface in surfaces && z.from < z.to)).toBe(true);
      expect(
        [...t.checkpoints, ...t.jumps.map((j) => j.at), ...t.hazards.map((h) => h.at)].every(
          (f) => f >= 0 && f <= 1,
        ),
      ).toBe(true);
      if (t.unlockAfter) expect(reg.tracks.has(t.unlockAfter)).toBe(true);
    },
  );

  it('modes only reference registered systems', () => {
    for (const m of reg.modes.all()) {
      expect(hasKey(m.nameKey)).toBe(true);
      for (const s of m.systems) expect(s in systemFactories).toBe(true);
    }
  });

  it('upgrades and achievements are complete', () => {
    for (const u of reg.upgrades.all()) {
      expect(hasKey(u.nameKey)).toBe(true);
      expect(u.costs.length).toBeGreaterThan(0);
    }
    for (const a of reg.achievements.all()) {
      expect(hasKey(a.nameKey)).toBe(true);
      expect(hasKey(a.descriptionKey)).toBe(true);
    }
  });

  it('the Italian dictionary translates every key', () => {
    for (const key of Object.keys(en)) expect(itDict[key as keyof typeof en]).toBeTruthy();
  });
});
