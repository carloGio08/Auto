import type { CarDef } from '../types';
import { trailblazer } from './trailblazer';
import { scout } from './scout';
import { crawler } from './crawler';
import { nomad } from './nomad';

/** All jeeps, in garage order. To add one: create a file next to these and list it here. */
export const cars: CarDef[] = [trailblazer, scout, crawler, nomad];
