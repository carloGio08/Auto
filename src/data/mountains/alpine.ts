import type { MountainDef } from '../types';

/**
 * Monte Drop: the main massif. 8 × 8 km map, ~1800 m from the snowy summit plateau to the
 * lake village. The main trail is routed through the waypoints with a grade limit, so it
 * hugs the contour lines and forms hairpins where the face is steep.
 */
export const alpine: MountainDef = {
  id: 'alpine',
  nameKey: 'mountain.alpine.name',
  descriptionKey: 'mountain.alpine.desc',
  seed: 1337,
  halfSize: 4000,
  summit: { x: 0, z: -1250, height: 1850, plateauRadius: 140 },
  baseHeight: 40,
  radii: { north: 3500, south: 3900, east: 3700, west: 3700 },
  spurs: { count: 6, amplitude: 85, twist: 0.6 },
  noise: {
    warp: 280,
    warpScale: 2600,
    low: { amplitude: 55, scale: 1700 },
    mid: { amplitude: 16, scale: 520 },
  },
  maxSlope: 0.95,
  cliffs: [
    { x: 1850, z: -400, angle: 0.4, length: 520, height: 34, width: 9 },
    { x: -1650, z: -900, angle: 1.2, length: 420, height: 30, width: 8 },
    { x: 1250, z: 1500, angle: -0.3, length: 320, height: 22, width: 7 },
  ],
  rimHeight: 950,
  lake: { x: 0, z: 2850, radius: 520, level: 36 },
  rivers: [
    { spring: [900, 700], width: 7, depth: 3 },
    { spring: [-1450, 650], width: 6, depth: 2.6 },
  ],
  biomes: { snowLine: 1450, rockLine: 1220, treeLine: 1020, denseForestLine: 520, valleyLine: 170 },
  trails: [
    {
      id: 'main',
      kind: 'main',
      waypoints: [
        [0, -1130],
        [720, -500],
        [-650, 200],
        [620, 950],
        [-320, 1650],
        [0, 2230],
      ],
      width: [7, 10],
      targetGrade: 0.17,
      maxGrade: 0.26,
    },
    {
      id: 'eastRidge',
      kind: 'branch',
      waypoints: [
        [720, -500],
        [1550, 400],
        [620, 950],
      ],
      startOn: 'main',
      endOn: 'main',
      width: [5.5, 7.5],
      targetGrade: 0.18,
      maxGrade: 0.28,
    },
    {
      id: 'gully',
      kind: 'shortcut',
      waypoints: [
        [-560, 300],
        [420, 900],
      ],
      startOn: 'main',
      endOn: 'main',
      width: [5, 6.5],
      targetGrade: 0.26,
      maxGrade: 0.38,
    },
  ],
  base: { x: 0, z: 2230, radius: 120 },
  start: { x: 0, z: -1130 },
  props: { trees: 1, rocks: 1, bushes: 1 },
  hazards: [
    { kind: 'icePatch', at: 0.06 },
    { kind: 'boulder', at: 0.16 },
    { kind: 'rockslide', at: 0.3 },
    { kind: 'mudPool', at: 0.46 },
    { kind: 'boulder', at: 0.6 },
    { kind: 'rockslide', at: 0.74 },
    { kind: 'mudPool', at: 0.88 },
  ],
  collectibles: { coins: 160, crystals: 10 },
  defaultTime: 'day',
  defaultWeather: 'clear',
  medals: { gold: 60000, silver: 32000, bronze: 12000 },
};
