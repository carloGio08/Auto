import { Simplex2 } from '../math/noise';
import { clamp, smoothstep } from '../math/util';
import type { PaletteKey, SurfaceId } from '../data/types';
import type { Mountain } from './mountain';

/** Terrain materials, each a ramp of the palette. */
export const MATERIALS = [
  'snow',
  'snowShade',
  'snowRock',
  'rockLight',
  'rockDark',
  'scree',
  'rockGrass',
  'earth',
  'mud',
  'sand',
  'dryGrass',
  'grass',
  'flowers',
  'undergrowth',
  'forest',
  'moss',
] as const satisfies readonly PaletteKey[];
export type Material = (typeof MATERIALS)[number];

export const enum Mat {
  Snow,
  SnowShade,
  SnowRock,
  RockLight,
  RockDark,
  Scree,
  RockGrass,
  Earth,
  Mud,
  Sand,
  DryGrass,
  Grass,
  Flowers,
  Undergrowth,
  Forest,
  Moss,
  Count,
}

/** What you drive on for each material (what you see is what you drive on). */
export const MATERIAL_SURFACE: Record<Material, SurfaceId> = {
  snow: 'snow',
  snowShade: 'snow',
  snowRock: 'rock',
  rockLight: 'rock',
  rockDark: 'rock',
  scree: 'scree',
  rockGrass: 'grass',
  earth: 'trail',
  mud: 'mud',
  sand: 'sand',
  dryGrass: 'grass',
  grass: 'grass',
  flowers: 'grass',
  undergrowth: 'forest',
  forest: 'forest',
  moss: 'forest',
};

/** Inputs of the material weights at one point. */
export interface BiomePoint {
  x: number;
  z: number;
  h: number;
  /** Unit normal (y up, z for the aspect). */
  ny: number;
  nz: number;
  /** Distance beyond the edge of the worn band of the closest trail (m, Infinity if none). */
  roadEdge: number;
}

/**
 * Ecology of the mountain: material weights (snow, rock, scree, soils, grasses, forest
 * floor...) from altitude, slope, aspect, curvature (valleys darker, wetter and greener;
 * crests lighter and rockier), wetness from the flow accumulation and a low-frequency wobble
 * of the snow line, plus the forest density shared with the tree placement. Transitions are
 * all smooth: no bands.
 */
export class BiomeModel {
  private readonly noise: Simplex2;
  private readonly patch: Simplex2;
  /** Last computed curvature, wetness and rockiness (for the colourer). */
  curvature = 0;
  moisture = 0;
  rough = 0;
  slope = 0;
  /** Forest density at the last point (0..1). */
  forest = 0;

  constructor(private readonly mountain: Mountain) {
    this.noise = new Simplex2(mountain.def.seed ^ 0x3b10);
    this.patch = new Simplex2(mountain.def.seed ^ 0x9e37);
  }

  /** Low-frequency wobble of the altitude bands (m). */
  wobble(x: number, z: number): number {
    return 55 * this.noise.fbm(x / 900, z / 900, 2) + 18 * Math.sin(x / 240 + z / 610);
  }

  /** Large patches (−1..1) used to vary tones and meadows (scale ~200 m and ~60 m). */
  patchNoise(x: number, z: number): number {
    return 0.7 * this.patch.noise(x / 210, z / 210) + 0.3 * this.patch.noise(x / 63 + 9.1, z / 63);
  }

  /**
   * Forest density (0..1): dense in valleys and on medium slopes, thin near the tree line,
   * almost none on flat meadows and terraces, clearings from noise, none on cliffs.
   */
  forestDensity(x: number, z: number, h: number, slope: number, moisture: number): number {
    const b = this.mountain.def.biomes;
    const a = h + this.wobble(x, z);
    if (a > b.treeLine + 40 || h < this.mountain.def.lake.level + 2) return 0;
    let alt: number;
    if (a > b.denseForestLine)
      alt = 0.15 + 0.85 * (1 - smoothstep(b.denseForestLine, b.treeLine + 40, a));
    else alt = 1;
    // Lowland meadows and fields around the village.
    alt *= 0.35 + 0.65 * smoothstep(b.valleyLine - 60, b.valleyLine + 80, a);
    const steep = 1 - smoothstep(0.62, 0.95, slope);
    const flat = 0.12 + 0.88 * smoothstep(0.07, 0.2, slope);
    const wet = 0.65 + 0.5 * moisture;
    const n = this.noise.fbm(x / 520 + 3.3, z / 520 - 1.7, 3);
    const clearings = smoothstep(-0.3, 0.3, n);
    return clamp(alt * steep * flat * wet * clearings, 0, 1);
  }

  /**
   * Normalised material weights at a point into `out` (length Mat.Count). Also updates
   * curvature, moisture, rough, slope and forest for the caller.
   */
  weights(p: BiomePoint, out: Float32Array): Float32Array {
    out.fill(0);
    const m = this.mountain;
    const def = m.def;
    const b = def.biomes;
    const f = m.field;
    const { x, z, h } = p;
    const ny = Math.max(0.05, p.ny);
    const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / ny;
    const cv = clamp(f.curvature(x, z) * 70, -1, 1);
    const wet = f.moisture(x, z);
    const rough = f.rough(x, z);
    this.curvature = cv;
    this.moisture = wet;
    this.rough = rough;
    this.slope = slope;
    const a = h + this.wobble(x, z);
    const lake = def.lake.level;

    // Shore and stream banks.
    const shore = 1 - smoothstep(lake + 0.6, lake + 3.2, h);
    if (shore > 0) out[Mat.Sand] = shore * 2;

    // Snow: above a wobbling snow line, slides off steep faces, shaded on north slopes and
    // in hollows.
    const sn = b.snowLine + 70 * this.patch.noise(x / 700 + 4, z / 700);
    let snow = smoothstep(sn - 60, sn + 80, a) * (1 - smoothstep(0.62, 0.95, slope));
    const shade = clamp(0.35 + p.nz * 0.55 + Math.max(0, cv) * 0.5, 0, 1);
    out[Mat.SnowShade] = snow * shade * 0.65;
    snow *= 1 - shade * 0.65;
    out[Mat.Snow] = snow;
    const snowAll = out[Mat.Snow] + out[Mat.SnowShade];

    // Rock: steep faces, rugged crests (convex) up high.
    const crest = Math.max(0, -cv) * smoothstep(b.rockLine - 250, b.rockLine + 50, a);
    let rock =
      smoothstep(0.58, 0.9, slope) +
      rough * 0.6 * smoothstep(0.3, 0.55, slope) +
      crest * 0.45 * smoothstep(0.15, 0.35, slope);
    rock = clamp(rock, 0, 1.2) * (1 - snowAll * 0.75);
    const lightFrac = clamp(0.25 + 0.6 * smoothstep(b.treeLine, b.snowLine, a) - cv * 0.3, 0, 1);
    out[Mat.RockLight] = rock * lightFrac;
    out[Mat.RockDark] = rock * (1 - lightFrac);
    out[Mat.SnowRock] = rock * Math.max(0, 1 - Math.abs(a - sn) / 160) * 0.9;

    // Scree aprons: concave, moderately steep, above the forest.
    out[Mat.Scree] =
      smoothstep(0.3, 0.52, slope) *
      (1 - smoothstep(0.8, 1.0, slope)) *
      smoothstep(b.treeLine - 180, b.treeLine + 60, a) *
      clamp(0.3 + Math.max(0, cv) * 0.8 + rough * 0.4, 0, 1.2) *
      (1 - snowAll);

    // Vegetation fills what is left.
    let used = 0;
    for (let i = 0; i < Mat.Count; i++) used += out[i];
    const veg = Math.max(0, 1 - used) * (1 - shore);
    if (veg > 0) {
      const alpine = smoothstep(b.treeLine - 60, b.rockLine - 40, a);
      out[Mat.RockGrass] = veg * smoothstep(b.rockLine - 180, b.rockLine + 60, a) * 0.55;
      const dryN = 0.5 + 0.5 * this.patch.noise(x / 330 - 2, z / 330 + 6);
      out[Mat.DryGrass] =
        veg * clamp(alpine * (0.35 + 0.65 * dryN) + Math.max(0, -cv) * 0.3, 0, 1) * (1 - wet);
      const forest = this.forestDensity(x, z, h, slope, wet);
      this.forest = forest;
      out[Mat.Forest] = veg * forest * forest;
      out[Mat.Undergrowth] = veg * forest * (1 - forest) * 1.4;
      // Flowering meadows: gentle ground, mid altitude, in patches.
      const meadow =
        (1 - smoothstep(0.12, 0.3, slope)) *
        smoothstep(b.valleyLine, b.valleyLine + 150, a) *
        (1 - smoothstep(b.treeLine - 50, b.treeLine + 120, a));
      out[Mat.Flowers] = veg * meadow * smoothstep(0.05, 0.45, this.patchNoise(x + 77, z)) * 0.8;
      out[Mat.Moss] = veg * smoothstep(0.5, 0.9, wet) * (0.4 + 0.6 * Math.max(0, cv));
      out[Mat.Mud] =
        veg *
        smoothstep(0.8, 1, wet) *
        (1 - smoothstep(0.05, 0.14, slope)) *
        (a < b.treeLine ? 0.7 : 0);
      // Bare soil on steep grassy slopes.
      const soil = smoothstep(0.42, 0.6, slope) * (1 - smoothstep(0.6, 0.8, slope)) * 0.35;
      let taken = 0;
      for (let i = Mat.RockGrass; i < Mat.Count; i++) if (i !== Mat.Grass) taken += out[i];
      out[Mat.Earth] = veg * soil;
      out[Mat.Grass] = Math.max(0.08 * veg, veg - taken - out[Mat.Earth]);
    }

    // Trampled fringe along the trails, and fresh cuts of the embankments.
    if (p.roadEdge < 3) {
      const fringe = 1 - smoothstep(0, 2.2, p.roadEdge);
      out[Mat.Earth] += fringe * (0.55 + smoothstep(0.35, 0.7, slope) * 1.5) * (1 - snowAll * 0.6);
    }

    let sum = 0;
    for (let i = 0; i < Mat.Count; i++) sum += out[i];
    const inv = sum > 0 ? 1 / sum : 0;
    for (let i = 0; i < Mat.Count; i++) out[i] *= inv;
    if (sum <= 0) out[Mat.Grass] = 1;
    return out;
  }

  /** Material with the largest weight. */
  static dominant(w: Float32Array): Material {
    let best = 0;
    for (let i = 1; i < Mat.Count; i++) if (w[i] > w[best]) best = i;
    return MATERIALS[best];
  }
}
