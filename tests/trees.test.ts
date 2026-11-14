import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { treeBreaks, treeTiers } from '../src/data/trees';
import { cars } from '../src/data/cars';
import { CollisionWorld } from '../src/world/colliders';
import { VehiclePhysics, type GroundProvider } from '../src/vehicle/physics';
import { TreeDebris } from '../src/world/treeDebris';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { Group, type Quaternion } from 'three';
import type { GroundSample } from '../src/terrain/terrain';
import type { TreeTier } from '../src/world/propGeometry';
import { config } from '../src/config';

const flat: GroundProvider = {
  sample(_x, _z, _y, out: GroundSample) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.surface = 'grass';
    out.onRoad = false;
    return out;
  },
  groundHeight: () => 0,
  normal: (_x, _z, out: Vector3) => out.set(0, 1, 0),
  waterLevel: () => -100,
};

describe('tree tiers', () => {
  const mass = 1650;
  it('young trees always break on a real impact', () => {
    expect(treeBreaks('young', mass, 0.5)).toBe(false);
    expect(treeBreaks('young', mass, 2)).toBe(true);
    expect(treeBreaks('young', 800, 3)).toBe(true);
  });

  it('medium trees break only above the energy threshold', () => {
    const vMin = Math.sqrt((2 * treeTiers.medium.breakEnergy) / mass);
    expect(vMin).toBeGreaterThan(6); // > ~22 km/h
    expect(vMin).toBeLessThan(11); // < ~40 km/h
    expect(treeBreaks('medium', mass, vMin * 0.95)).toBe(false);
    expect(treeBreaks('medium', mass, vMin * 1.05)).toBe(true);
    // A heavier jeep snaps it at a lower speed.
    expect(treeBreaks('medium', 1850, vMin * 0.97)).toBe(true);
  });

  it('old trees never break', () => {
    for (const v of [1, 10, 30, 80]) expect(treeBreaks('old', 3000, v)).toBe(false);
  });

  it('robustness grows with the tier', () => {
    expect(treeTiers.young.speedLoss).toBeLessThan(treeTiers.medium.speedLoss);
    expect(treeTiers.young.pieces).toBeGreaterThanOrEqual(1);
    expect(treeTiers.medium.pieces).toBeLessThanOrEqual(3);
  });
});

describe('driving into trees', () => {
  const hit = (
    tier: TreeTier,
    speed: number,
  ): { through: boolean; speed: number; broke: number } => {
    const world = new CollisionWorld();
    const c = world.addCircle('tree', 0, 20, 0.3, -1, 8);
    let broke = 0;
    world.breakHandler = (col, v, car) => {
      if (col !== c || !treeBreaks(tier, car.mass, v)) return false;
      col.enabled = false;
      car.velocity.multiplyScalar(1 - treeTiers[tier].speedLoss);
      broke++;
      return true;
    };
    const car = new VehiclePhysics(structuredClone(cars[0].physics));
    car.reset(0, 0.9, 0, 0);
    for (let i = 0; i < 60; i++)
      car.step(
        1 / 120,
        { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, hold: true },
        flat,
      );
    car.velocity.set(0, 0, speed);
    for (let i = 0; i < 240; i++) {
      car.step(
        1 / 120,
        { throttle: 0.3, brake: 0, steer: 0, handbrake: false, nitro: false },
        flat,
      );
      world.resolveVehicle(car, i / 120);
    }
    return { through: car.position.z > 22, speed: car.speed, broke };
  };

  it('snaps a young tree and keeps going', () => {
    const r = hit('young', 12);
    expect(r.broke).toBe(1);
    expect(r.through).toBe(true);
    expect(r.speed).toBeGreaterThan(8);
  });

  it('a slow nudge does not fell a medium tree, a fast hit does', () => {
    expect(hit('medium', 4).through).toBe(false);
    const fast = hit('medium', 14);
    expect(fast.broke).toBe(1);
    expect(fast.through).toBe(true);
  });

  it('an old tree stops the jeep', () => {
    const r = hit('old', 14);
    expect(r.broke).toBe(0);
    expect(r.through).toBe(false);
  });
});

describe('tree debris', () => {
  it('stays finite, settles on the ground and respects the pool size', () => {
    const debris = new TreeDebris(new Group(), resolvePalette(defaultPalette), false, 10);
    for (let i = 0; i < 25; i++) debris.spawn((i % 3) as 0 | 1 | 2, i, 3, 0, 1, 8, 3, 2, 0, 1, 3);
    expect(debris.count).toBeLessThanOrEqual(10);
    const car = new Vector3(0, -50, 0);
    const vel = new Vector3();
    for (let i = 0; i < 120 * 6; i++) debris.step(1 / 120, flat, car, vel);
    debris.sync();
    expect(debris.count).toBe(10);
    for (let i = 0; i < 120 * (config.world.debrisLifetime + 2); i++)
      debris.step(1 / 120, flat, car, vel);
    expect(debris.count).toBe(0);
  });

  it('a snapped top topples over instead of balancing upright', () => {
    const debris = new TreeDebris(new Group(), resolvePalette(defaultPalette), false, 4);
    debris.spawn(1, 0, 3.4, 0, 1, 0, 0, 0, 1, 0, 0); // no initial spin, perfectly upright
    const car = new Vector3(0, -50, 0);
    for (let i = 0; i < 120 * 5; i++) debris.step(1 / 120, flat, car, new Vector3());
    const piece = (debris as unknown as { pieces: { quat: Quaternion }[] }).pieces[0];
    const up = new Vector3(0, 1, 0).applyQuaternion(piece.quat);
    expect(Math.abs(up.y)).toBeLessThan(0.5);
  });
});
