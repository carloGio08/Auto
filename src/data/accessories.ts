import type { CarLookDef } from './types';

/** Jeep accessories that can be bought in the garage and switched on and off. */
export type AccessoryId = 'roofRack' | 'cargo' | 'lightBar' | 'snorkel' | 'spareWheel';

export interface AccessoryDef {
  id: AccessoryId;
  nameKey: string;
  /** Coins (0 when the jeep comes with it). */
  price: number;
  /** Another accessory it needs (cargo sits on the roof rack). */
  requires?: AccessoryId;
}

export const accessories: AccessoryDef[] = [
  { id: 'roofRack', nameKey: 'accessory.roofRack', price: 400 },
  { id: 'cargo', nameKey: 'accessory.cargo', price: 250, requires: 'roofRack' },
  { id: 'lightBar', nameKey: 'accessory.lightBar', price: 350 },
  { id: 'snorkel', nameKey: 'accessory.snorkel', price: 300 },
  { id: 'spareWheel', nameKey: 'accessory.spareWheel', price: 150 },
];

/** Paints after the first `FREE_PAINTS` of a jeep cost `PAINT_PRICE` coins each. */
export const FREE_PAINTS = 3;
export const PAINT_PRICE = 200;

/** Accessories a jeep comes with from the factory (owned for free). */
export const factoryAccessories = (look: CarLookDef): AccessoryId[] =>
  accessories.filter((a) => look[a.id]).map((a) => a.id);

/**
 * The look of a jeep with the player's choices: accessories switched on are shown (cargo
 * only with the roof rack), the others hidden. Without a choice the factory look stays.
 */
export function customizedLook(look: CarLookDef, on: AccessoryId[] | undefined): CarLookDef {
  if (!on) return look;
  const out: CarLookDef = { ...look };
  for (const a of accessories) out[a.id] = on.includes(a.id);
  return out;
}
