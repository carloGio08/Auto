import { describe, expect, it } from 'vitest';
import { createRegistries, Registry } from '../src/data/registry';
import { en } from '../src/i18n/en';
import { it as itDict } from '../src/i18n/it';
import { systemFactories } from '../src/systems';
import { createDailyMountain } from '../src/data/mountains';

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

  it.each(
    [...reg.mountains.all(), createDailyMountain('2026-11-13')].map((t) => [t.id, t] as const),
  )('mountain %s has every required field', (_id, t) => {
    expect(hasKey(t.nameKey)).toBe(true);
    expect(hasKey(t.descriptionKey)).toBe(true);
    expect(t.medals.gold).toBeGreaterThan(t.medals.silver);
    expect(t.medals.silver).toBeGreaterThan(t.medals.bronze);
    expect(t.halfSize).toBeGreaterThanOrEqual(3000);
    expect(t.summit.height - t.baseHeight).toBeGreaterThan(1400);
    expect(t.trails[0].kind).toBe('main');
    expect(t.trails.every((tr) => tr.waypoints.length >= 2 && tr.maxGrade > tr.targetGrade)).toBe(
      true,
    );
    const ids = new Set(t.trails.map((tr) => tr.id));
    for (const tr of t.trails) {
      if (tr.startOn) expect(ids.has(tr.startOn)).toBe(true);
      if (tr.endOn) expect(ids.has(tr.endOn)).toBe(true);
    }
    const b = t.biomes;
    expect(
      b.snowLine > b.rockLine && b.rockLine > b.treeLine && b.treeLine > b.denseForestLine,
    ).toBe(true);
    expect(t.hazards.every((h) => h.at >= 0 && h.at <= 1)).toBe(true);
    if (t.unlockAfter) expect(reg.mountains.has(t.unlockAfter)).toBe(true);
  });

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
