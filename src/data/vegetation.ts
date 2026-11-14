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

/** Undergrowth kinds (low-poly, instanced near the jeep only). */
export type UndergrowthKind = 'bush' | 'grass' | 'fern' | 'flowerY' | 'flowerP' | 'log' | 'stump';

export interface UndergrowthDef {
  kind: UndergrowthKind;
  /** Base size (m) and random range factor. */
  size: [number, number];
  /** Where (biome materials weights it follows; see propPlacement). */
  habitat: 'forest' | 'meadow' | 'grass' | 'edge';
  /** Instances per 100 m² at full habitat. */
  density: number;
}

export const undergrowth: UndergrowthDef[] = [
  { kind: 'bush', size: [0.8, 1.6], habitat: 'edge', density: 0.6 },
  { kind: 'grass', size: [0.35, 0.7], habitat: 'grass', density: 3.2 },
  { kind: 'fern', size: [0.5, 0.9], habitat: 'forest', density: 2.2 },
  { kind: 'flowerY', size: [0.25, 0.4], habitat: 'meadow', density: 2.4 },
  { kind: 'flowerP', size: [0.25, 0.4], habitat: 'meadow', density: 1.6 },
  { kind: 'log', size: [3, 6], habitat: 'forest', density: 0.06 },
  { kind: 'stump', size: [0.5, 0.9], habitat: 'forest', density: 0.12 },
];

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
