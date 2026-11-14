import type { PaletteKey } from './types';

/**
 * Pine forms the prop geometry builds (stylised tiered pines, see propGeometry.ts): 'pine'
 * broad tiers, 'spruce' one more tier and slimmer, 'larch' like pine (lighter colours).
 */
export type TreeShape = 'pine' | 'spruce' | 'larch';

/**
 * A tree species. Heights are realistic (m) per age, 6–25 m; age also sets the model (young
 * 4 tiers, medium 5, old 6) and how the tree reacts to the jeep (young snaps, medium snaps
 * above an energy, old is solid: data/trees.ts). `zone` is a normalised altitude: 0 at the
 * valley line, 1 at the tree line.
 */
export interface TreeSpeciesDef {
  id: string;
  shape: TreeShape;
  heights: { young: [number, number]; medium: [number, number]; old: [number, number] };
  /** Crown width / height. */
  width: number;
  /** Where it grows: normalised altitude band (soft edges) and preferred wetness (0..1). */
  zone: [number, number];
  moisture: [number, number];
  /** Relative abundance where it can grow. */
  weight: number;
  /** Crown colours: palette ramp and tone indices [shaded, sunlit]. */
  foliage: { key: PaletteKey; tones: [number, number] };
  /** Snow on the crown above the snow line minus this (m). */
  snowCap?: number;
}

export const treeSpecies: TreeSpeciesDef[] = [
  {
    // Valley fir: broad, bright green.
    id: 'fir',
    shape: 'pine',
    heights: { young: [6, 8], medium: [10, 15], old: [17, 23] },
    width: 0.48,
    zone: [-0.4, 0.45],
    moisture: [0.2, 1],
    weight: 1,
    foliage: { key: 'foliage', tones: [1, 3] },
  },
  {
    id: 'spruce',
    shape: 'spruce',
    heights: { young: [6, 9], medium: [12, 17], old: [19, 25] },
    width: 0.4,
    zone: [0.05, 0.85],
    moisture: [0.3, 1],
    weight: 1.2,
    foliage: { key: 'foliage', tones: [0, 2] },
  },
  {
    id: 'pine',
    shape: 'pine',
    heights: { young: [6, 8], medium: [10, 14], old: [15, 21] },
    width: 0.46,
    zone: [0.25, 1],
    moisture: [0, 0.6],
    weight: 1,
    foliage: { key: 'foliage', tones: [0, 3] },
    snowCap: 80,
  },
  {
    id: 'larch',
    shape: 'larch',
    heights: { young: [6, 8], medium: [10, 14], old: [15, 20] },
    width: 0.42,
    zone: [0.65, 1.12],
    moisture: [0, 1],
    weight: 0.8,
    foliage: { key: 'forest', tones: [1, 3] },
    snowCap: 60,
  },
];

/** Smallest tree height (m), whatever the altitude: smaller woody plants are bushes. */
export const MIN_TREE_HEIGHT = 6;

/** Ground-cover kinds (low-poly, instanced and streamed per tile near the camera). */
export type UndergrowthKind =
  | 'grass'
  | 'flowerY'
  | 'flowerR'
  | 'flowerP'
  | 'flowerW'
  | 'bush'
  | 'fern'
  | 'pebble'
  | 'log'
  | 'stump';

export interface UndergrowthDef {
  kind: UndergrowthKind;
  /** Base size (m) and random range factor. */
  size: [number, number];
  /**
   * Where it grows: 'forest' floor, 'meadow' (flower patches), 'grass', forest 'edge',
   * 'road' (pebbles on and beside the trails).
   */
  habitat: 'forest' | 'meadow' | 'grass' | 'edge' | 'road';
  /** Instances per 100 m² at full habitat (before the preset density). */
  density: number;
  /** Instance cap group (preset limits: grassLimit, flowerLimit, coverLimit). */
  cap: 'grass' | 'flowers' | 'cover';
  /** Sways in the wind (vertex shader; off on the Low preset). */
  wind: boolean;
  /** Casts a shadow. */
  shadow: boolean;
  /** Visible up to this fraction of the cover distance (small things fade sooner). */
  reach: number;
}

export const undergrowth: UndergrowthDef[] = [
  {
    kind: 'flowerY',
    size: [0.4, 0.65],
    habitat: 'meadow',
    density: 110,
    cap: 'flowers',
    wind: true,
    shadow: true,
    reach: 0.85,
  },
  {
    kind: 'flowerR',
    size: [0.4, 0.65],
    habitat: 'meadow',
    density: 110,
    cap: 'flowers',
    wind: true,
    shadow: true,
    reach: 0.85,
  },
  {
    kind: 'flowerP',
    size: [0.4, 0.65],
    habitat: 'meadow',
    density: 110,
    cap: 'flowers',
    wind: true,
    shadow: true,
    reach: 0.85,
  },
  {
    kind: 'flowerW',
    size: [0.4, 0.65],
    habitat: 'meadow',
    density: 110,
    cap: 'flowers',
    wind: true,
    shadow: true,
    reach: 0.85,
  },
  {
    kind: 'grass',
    size: [0.55, 1.05],
    habitat: 'grass',
    density: 90,
    cap: 'grass',
    wind: true,
    shadow: false,
    reach: 1,
  },
  {
    kind: 'bush',
    size: [0.8, 1.5],
    habitat: 'edge',
    density: 1.2,
    cap: 'cover',
    wind: false,
    shadow: true,
    reach: 1,
  },
  {
    kind: 'fern',
    size: [0.5, 0.9],
    habitat: 'forest',
    density: 6,
    cap: 'cover',
    wind: true,
    shadow: false,
    reach: 0.8,
  },
  {
    kind: 'pebble',
    size: [0.1, 0.28],
    habitat: 'road',
    density: 16,
    cap: 'cover',
    wind: false,
    shadow: false,
    reach: 0.55,
  },
  {
    kind: 'log',
    size: [3, 6],
    habitat: 'forest',
    density: 0.08,
    cap: 'cover',
    wind: false,
    shadow: true,
    reach: 1,
  },
  {
    kind: 'stump',
    size: [0.5, 0.9],
    habitat: 'forest',
    density: 0.16,
    cap: 'cover',
    wind: false,
    shadow: true,
    reach: 1,
  },
];

/** Flower patches: noise scale (m) and threshold (higher = fewer, tighter patches). */
export const flowerPatches = { scale: 6, threshold: 0.5, colourCell: 14 };

/**
 * Ecology rules: minimum distance between trees (Poisson disk, m), how strongly forests
 * clump (exponent on the density; > 1 makes compact woods and clear glades), and the
 * low-frequency noise that draws the woods and glades (scale m).
 */
export const ecology = {
  minTreeDistance: 3.1,
  clumping: 1.2,
  clusterScale: 260,
  /** Trees thin out and shrink towards the tree line (fraction kept at the line). */
  treeLineDensity: 0.25,
  treeLineHeight: 0.55,
  /** Steepest ground with trees (rise/run, ≈ 40°). */
  maxSlope: 0.84,
  /** Density of lone trees scattered in open meadows (0..1). */
  loneTrees: 0.035,
  /** Distance from the worn band of a trail kept free (m). */
  trailClearance: 2.5,
};
