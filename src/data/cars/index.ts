import type { CarDef } from '../types';
import { ridgeRunner } from './ridgeRunner';
import { sidewinder } from './sidewinder';
import { hopper } from './hopper';
import { avalanche } from './avalanche';

/** All cars, in garage order. To add a car: create a file next to these and list it here. */
export const cars: CarDef[] = [ridgeRunner, sidewinder, hopper, avalanche];
