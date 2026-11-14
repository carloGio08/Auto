import type { AchievementDef, CarDef, ModeDef, ModeId, MountainDef, UpgradeDef } from './types';
import { cars } from './cars';
import { mountains } from './mountains';
import { upgrades } from './upgrades';
import { achievements } from './achievements';
import { modes } from './modes';

/** Typed lookup table over an array of content definitions. */
export class Registry<T extends { id: string }> {
  private readonly map = new Map<string, T>();

  constructor(
    readonly kind: string,
    items: readonly T[] = [],
  ) {
    items.forEach((i) => this.register(i));
  }

  register(item: T): this {
    if (this.map.has(item.id)) throw new Error(`Duplicate ${this.kind} id "${item.id}"`);
    this.map.set(item.id, item);
    return this;
  }

  get(id: string): T {
    const item = this.map.get(id);
    if (!item) throw new Error(`Unknown ${this.kind} "${id}"`);
    return item;
  }

  tryGet(id: string): T | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  all(): T[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }
}

export interface ContentRegistries {
  cars: Registry<CarDef>;
  mountains: Registry<MountainDef>;
  upgrades: Registry<UpgradeDef>;
  achievements: Registry<AchievementDef>;
  modes: Registry<ModeDef & { id: ModeId }>;
}

export function createRegistries(): ContentRegistries {
  return {
    cars: new Registry('car', cars),
    mountains: new Registry('mountain', mountains),
    upgrades: new Registry('upgrade', upgrades),
    achievements: new Registry('achievement', achievements),
    modes: new Registry('mode', Object.values(modes)),
  };
}
