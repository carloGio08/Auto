import type { MountainDef } from '../types';
import { alpine } from './alpine';
import { granite } from './granite';

/** Playable mountains in menu order. To add one: create a file here and list it below. */
export const mountains: MountainDef[] = [alpine, granite];

export { createDailyMountain, todayKey } from './daily';
