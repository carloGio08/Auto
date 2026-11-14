import type { MountainDef } from '../types';
import { alpine } from './alpine';
import { variantOf } from './variants';

const shape = variantOf(alpine, {
  seed: 4242,
  mirror: true,
  jitter: 140,
  relief: 1.12,
  rugged: 1.3,
});

/**
 * Granite Massif: the mirror image of Monte Drop's layout, with higher relief, rockier crests,
 * two extra cirques and a long scree face, more snow and fewer trees.
 */
export const granite: MountainDef = {
  ...shape,
  id: 'granite',
  nameKey: 'mountain.granite.name',
  descriptionKey: 'mountain.granite.desc',
  summit: { ...shape.summit, height: 1740 },
  terracing: { amount: 0.7, scale: 1200 },
  erosion: { ...shape.erosion, talus: 0.72 },
  noise: { ...shape.noise, detail: { amplitude: 0.4, rugged: 2, scale: 50 } },
  landforms: [
    ...shape.landforms,
    { kind: 'cirque', at: [1500, -1150], radius: 280, height: 45, wall: 0.8, rugged: 1 },
    { kind: 'cirque', at: [-1700, -900], radius: 260, height: 40, wall: 0.8, rugged: 1 },
    {
      kind: 'slope',
      path: [
        [600, 300],
        [1300, 700],
      ],
      radius: 70,
      height: 40,
      rugged: 1,
    },
  ],
  biomes: { snowLine: 1300, rockLine: 1100, treeLine: 960, denseForestLine: 500, valleyLine: 180 },
  props: { trees: 0.8, rocks: 1.4, bushes: 0.7 },
  hazards: [
    { kind: 'rockslide', at: 0.12 },
    { kind: 'icePatch', at: 0.2 },
    { kind: 'boulder', at: 0.33 },
    { kind: 'rockslide', at: 0.48 },
    { kind: 'boulder', at: 0.62 },
    { kind: 'mudPool', at: 0.8 },
  ],
  collectibles: { coins: 190, crystals: 12 },
  defaultTime: 'sunset',
  defaultWeather: 'clear',
  medals: { gold: 70000, silver: 38000, bronze: 15000 },
  unlockAfter: 'alpine',
};
