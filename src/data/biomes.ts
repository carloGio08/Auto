import type { UndergrowthKind } from './vegetation';

/**
 * Biomes: what grows and lies on the ground in each zone of the mountain, and the minimum
 * richness the generator guarantees there. Classified per point from the ecology sample
 * (world/biomeClass.ts); every biome has a complete prop set so no zone is left bare.
 */
export type BiomeId =
  | 'valleyMeadow'
  | 'forest'
  | 'forestEdge'
  | 'steepMeadow'
  | 'alpineMeadow'
  | 'treeLine'
  | 'scree'
  | 'rockBand'
  | 'snowfield'
  | 'shore';

export interface BiomeProp {
  kind: UndergrowthKind;
  /** Instances per 100 m² at full density (before the preset density). */
  density: number;
}

export interface BiomeDef {
  id: BiomeId;
  /** Ground cover of the biome (also the only kinds the filler pass may add). */
  props: BiomeProp[];
  /**
   * Rock outcrops: clusters of 3–7 faceted rocks per hectare, along contour lines, ribs and
   * crests (placed with the rocks in propPlacement.ts, with colliders).
   */
  outcrops: number;
  /** Richness guarantee per ~32 m cell (see world/richness.ts). */
  richness: {
    /** Minimum and maximum ground-cover instances per 100 m² (at full density). */
    minDensity: number;
    maxDensity: number;
    /** Minimum number of different prop kinds in a cell. */
    minTypes: number;
  };
  /** Meso relief amplitude (m) on slopes: terracettes, gullies, ribs, bumps. */
  relief: { terracettes: number; gullies: number; ribs: number; bumps: number };
  /** Counted in the richness guarantee (meadows and everything below the tree line). */
  guaranteed: boolean;
}

const flowers = (d: number): BiomeProp[] =>
  (['flowerY', 'flowerW', 'flowerK', 'flowerP', 'flowerB'] as UndergrowthKind[]).map((kind) => ({
    kind,
    density: d / 5,
  }));

export const biomes: Record<BiomeId, BiomeDef> = {
  valleyMeadow: {
    id: 'valleyMeadow',
    props: [
      { kind: 'grass', density: 60 },
      ...flowers(16),
      { kind: 'shrubRound', density: 0.9 },
      { kind: 'shrubSpiky', density: 0.5 },
      { kind: 'stone', density: 1.2 },
    ],
    outcrops: 0.35,
    richness: { minDensity: 30, maxDensity: 110, minTypes: 3 },
    relief: { terracettes: 0, gullies: 0.15, ribs: 0, bumps: 0.25 },
    guaranteed: true,
  },
  forest: {
    id: 'forest',
    props: [
      { kind: 'fern', density: 8 },
      { kind: 'grass', density: 12 },
      { kind: 'shrubRound', density: 1.2 },
      { kind: 'stone', density: 0.8 },
      { kind: 'log', density: 0.1 },
      { kind: 'stump', density: 0.2 },
      { kind: 'sapling', density: 0.4 },
    ],
    outcrops: 0.5,
    richness: { minDensity: 10, maxDensity: 60, minTypes: 3 },
    relief: { terracettes: 0, gullies: 0.25, ribs: 0.2, bumps: 0.3 },
    guaranteed: true,
  },
  forestEdge: {
    id: 'forestEdge',
    props: [
      { kind: 'grass', density: 38 },
      ...flowers(7),
      { kind: 'fern', density: 3 },
      { kind: 'shrubRound', density: 1.6 },
      { kind: 'shrubSpiky', density: 1 },
      { kind: 'sapling', density: 0.7 },
      { kind: 'stone', density: 1 },
    ],
    outcrops: 0.6,
    richness: { minDensity: 22, maxDensity: 90, minTypes: 3 },
    relief: { terracettes: 0.1, gullies: 0.25, ribs: 0.2, bumps: 0.3 },
    guaranteed: true,
  },
  steepMeadow: {
    id: 'steepMeadow',
    props: [
      { kind: 'grass', density: 48 },
      ...flowers(10),
      { kind: 'shrubSpiky', density: 1.3 },
      { kind: 'shrubMat', density: 1.6 },
      { kind: 'shrubRound', density: 0.6 },
      { kind: 'stone', density: 3.5 },
      { kind: 'sapling', density: 0.15 },
    ],
    outcrops: 2.8,
    richness: { minDensity: 26, maxDensity: 95, minTypes: 4 },
    relief: { terracettes: 0.32, gullies: 0.6, ribs: 0.5, bumps: 0.35 },
    guaranteed: true,
  },
  alpineMeadow: {
    id: 'alpineMeadow',
    props: [
      { kind: 'grass', density: 52 },
      ...flowers(12),
      { kind: 'shrubMat', density: 1.9 },
      { kind: 'shrubSpiky', density: 0.8 },
      { kind: 'stone', density: 2.8 },
    ],
    outcrops: 1.6,
    richness: { minDensity: 28, maxDensity: 100, minTypes: 4 },
    relief: { terracettes: 0.22, gullies: 0.4, ribs: 0.35, bumps: 0.35 },
    guaranteed: true,
  },
  treeLine: {
    id: 'treeLine',
    props: [
      { kind: 'grass', density: 42 },
      ...flowers(7),
      { kind: 'sapling', density: 1.3 },
      { kind: 'fern', density: 1.5 },
      { kind: 'shrubMat', density: 1.5 },
      { kind: 'shrubRound', density: 0.8 },
      { kind: 'stone', density: 2.2 },
    ],
    outcrops: 1.3,
    richness: { minDensity: 25, maxDensity: 95, minTypes: 4 },
    relief: { terracettes: 0.25, gullies: 0.45, ribs: 0.4, bumps: 0.35 },
    guaranteed: true,
  },
  scree: {
    id: 'scree',
    props: [
      { kind: 'stone', density: 7 },
      { kind: 'grass', density: 14 },
      { kind: 'shrubMat', density: 0.9 },
      ...flowers(1.5),
    ],
    outcrops: 3,
    richness: { minDensity: 10, maxDensity: 60, minTypes: 3 },
    relief: { terracettes: 0, gullies: 0.5, ribs: 0.4, bumps: 0.3 },
    guaranteed: false,
  },
  rockBand: {
    id: 'rockBand',
    props: [
      { kind: 'stone', density: 6 },
      { kind: 'grass', density: 5 },
      { kind: 'shrubMat', density: 0.6 },
    ],
    outcrops: 4,
    richness: { minDensity: 5, maxDensity: 40, minTypes: 2 },
    relief: { terracettes: 0, gullies: 0.5, ribs: 0.6, bumps: 0.3 },
    guaranteed: false,
  },
  snowfield: {
    id: 'snowfield',
    props: [{ kind: 'stone', density: 0.8 }],
    outcrops: 0.8,
    richness: { minDensity: 0, maxDensity: 10, minTypes: 1 },
    relief: { terracettes: 0, gullies: 0.2, ribs: 0.2, bumps: 0.2 },
    guaranteed: false,
  },
  shore: {
    id: 'shore',
    props: [
      { kind: 'grass', density: 32 },
      ...flowers(4),
      { kind: 'stone', density: 3 },
      { kind: 'shrubRound', density: 0.6 },
    ],
    outcrops: 0.3,
    richness: { minDensity: 14, maxDensity: 80, minTypes: 3 },
    relief: { terracettes: 0, gullies: 0, ribs: 0, bumps: 0.15 },
    guaranteed: true,
  },
};

/** Biome ids in a fixed order (index stored in the ecology sample). */
export const BIOME_IDS = Object.keys(biomes) as BiomeId[];

/**
 * Richness score per cell (world/richness.ts): weights of its components and the pass
 * threshold. Colour: standard deviation of the ground colour (0..255 per channel) in the
 * cell; relief: residual standard deviation (m) of a plane fitted to the cell on 15–40°
 * slopes outside the declared flats.
 */
export const richnessRules = {
  cellSize: 32,
  threshold: 0.8,
  weights: { variety: 0.3, density: 0.3, colour: 0.2, relief: 0.2 },
  colourStd: [7, 40] as [number, number],
  reliefStd: 0.12,
  slopeBand: [0.27, 0.84] as [number, number],
};
