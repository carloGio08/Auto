import type { SystemId } from '../data/types';
import type { GameSystem } from './system';
import { NitroSystem } from './nitro';
import { StyleSystem } from './style';
import { HazardsSystem } from './hazards';
import { CollectiblesSystem } from './collectibles';
import { MedalsSystem } from './medals';
import { AchievementsSystem } from './achievements';

/**
 * Registry of gameplay systems. To add a mechanic: implement GameSystem (or extend
 * BaseSystem), add its id to SystemId in data/types.ts and register the factory here.
 */
export const systemFactories: Record<SystemId, () => GameSystem> = {
  nitro: () => new NitroSystem(),
  style: () => new StyleSystem(),
  hazards: () => new HazardsSystem(),
  collectibles: () => new CollectiblesSystem(),
  medals: () => new MedalsSystem(),
  achievements: () => new AchievementsSystem(),
};

export function createSystem(id: SystemId): GameSystem {
  const factory = systemFactories[id];
  if (!factory) throw new Error(`Unknown system "${id}"`);
  return factory();
}
