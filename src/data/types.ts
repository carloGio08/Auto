import type { ObjectiveDef } from './objectives';
/**
 * Content type definitions. Everything the game can be extended with is described here as data.
 */

export type SurfaceId =
  | 'trail'
  | 'gravel'
  | 'grass'
  | 'forest'
  | 'snow'
  | 'scree'
  | 'rock'
  | 'mud'
  | 'sand'
  | 'ice'
  | 'wood';

export interface SurfaceDef {
  id: SurfaceId;
  /** Friction multiplier (1 = packed dirt trail baseline). Always "good" by design. */
  grip: number;
  /** Extra rolling resistance (fraction of weight). */
  rollingDrag: number;
  /** Palette entry used for particles thrown up by the wheels. */
  color: PaletteKey;
  /** Particle kind spawned when sliding / at speed. */
  particle: 'dust' | 'snow' | 'mud' | 'gravel' | 'none';
  /** Audio texture (0 = smooth, 1 = loud gravel crunch). */
  roughness: number;
  /** Random vertical bumpiness amplitude (m) felt by the suspension. */
  bumpiness: number;
}

export type DriveType = 'awd' | 'rwd' | 'fwd';
/** Jeep body proportions: short (agile), standard, long (pickup bed). */
export type JeepBody = 'short' | 'standard' | 'long';

export interface CarPhysicsDef {
  /** Mass (kg). */
  mass: number;
  /** Chassis box used for inertia and ground contact (m). */
  chassis: { length: number; width: number; height: number };
  /** Height of the centre of mass above the wheel mounts (m, negative = lower). */
  comOffsetY: number;
  wheelbase: number;
  trackWidth: number;
  wheelRadius: number;
  /** Mount height relative to the centre of mass (m). */
  mountY: number;
  suspension: {
    restLength: number;
    maxTravel: number;
    /** Spring rate (N/m) per wheel. */
    stiffness: number;
    dampingBump: number;
    dampingRebound: number;
    antiRollFront: number;
    antiRollRear: number;
  };
  tires: {
    /** Friction coefficient baseline. */
    grip: number;
    /** Rear/front grip ratio (<1 = oversteer, drifty). */
    rearBias: number;
    /** Lateral cornering stiffness relative to load (1/rad). */
    corneringStiffness: number;
  };
  engine: {
    /** Power (W). */
    power: number;
    /** Maximum traction force (N). */
    maxForce: number;
    drive: DriveType;
    brakeForce: number;
    reverseForce: number;
    /** Engine braking with the throttle released (N per m/s, capped). */
    engineBrake: number;
  };
  aero: { drag: number; downforce: number };
  steering: { maxAngle: number };
  nitro: { force: number; capacity: number; burnRate: number };
  /** Extra force pressing the jeep onto the ground along its normal (fraction of weight). */
  groundStick: number;
  /** Strength of the on-ground anti-flip assist (rad/s² per rad of excess roll). */
  antiFlip: number;
}

/** Visual configuration of a jeep: few flat colours and accessories. */
export interface CarLookDef {
  body: JeepBody;
  /** Paint options (first = default). */
  colors: string[];
  /** Bumpers, flares, rollbar. */
  accent: string;
  roofRack: boolean;
  spareWheel: boolean;
  /** Jerrycans and a backpack on the rack. */
  cargo: boolean;
  lightBar: boolean;
  snorkel: boolean;
  /** Visual tyre width (m). */
  wheelWidth: number;
}

/** A drivable jeep (registered in src/data/cars). */
export interface CarDef {
  id: string;
  nameKey: string;
  descriptionKey: string;
  /** Coins needed to buy it (0 = owned from the start). */
  price: number;
  /** Achievement id required before it can be bought. */
  requiresAchievement?: string;
  /** Normalised stats (0..1) shown in the garage. */
  stats: { speed: number; grip: number; suspension: number; weight: number };
  physics: CarPhysicsDef;
  look: CarLookDef;
}

export type UpgradeId = 'suspension' | 'grip' | 'nitro' | 'engine';

export interface UpgradeDef {
  id: UpgradeId;
  nameKey: string;
  descriptionKey: string;
  /** Cost per level (index = level - 1). */
  costs: number[];
  /** Applies level (0..n) to a copy of the car physics. */
  apply(physics: CarPhysicsDef, level: number): void;
}

export type TimeOfDayId = 'dawn' | 'day' | 'sunset' | 'night';
export type WeatherId = 'clear' | 'fog' | 'snow';

export interface TimeOfDayDef {
  id: TimeOfDayId;
  nameKey: string;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: string;
  sunIntensity: number;
  ambientSky: string;
  ambientGround: string;
  ambientIntensity: number;
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fogColor: string;
  headlights: boolean;
  stars: boolean;
}

export interface WeatherDef {
  id: WeatherId;
  nameKey: string;
  /** Fog distance multiplier (1 = clear). */
  fogDensity: number;
  /** Grip multiplier applied on top of surfaces. */
  gripMultiplier: number;
  snowfall: number;
  cloudCover: number;
  /** Desaturation towards grey for the sky/fog (0..1). */
  overcast: number;
}

/** Keys of the world palette (src/data/palette.ts): one ramp of tones per material. */
export type PaletteKey =
  | 'snow'
  | 'snowShade'
  | 'snowRock'
  | 'rockLight'
  | 'rockDark'
  | 'scree'
  | 'rockGrass'
  | 'earth'
  | 'mud'
  | 'sand'
  | 'dryGrass'
  | 'grass'
  | 'flowers'
  | 'undergrowth'
  | 'forest'
  | 'moss'
  | 'water'
  | 'wood'
  | 'foliage'
  | 'paint';

/** A position along the main trail expressed as a fraction of its length (0..1). */
export type TrailFraction = number;

export type HazardKind = 'boulder' | 'rockslide' | 'mudPool' | 'icePatch';

export interface HazardPlacement {
  kind: HazardKind;
  at: TrailFraction;
  /** Lateral offset from the trail centre (m). */
  offset?: number;
}

export interface HazardDef {
  kind: HazardKind;
  nameKey: string;
  /** Distance ahead of the car (m along the main trail) at which it activates. */
  triggerDistance: number;
  /** Radius of the collider / zone (m). */
  radius: number;
  /** Surface applied by zone hazards. */
  surface?: SurfaceId;
}

/** A trail is routed between waypoints with a grade-limited path search, then carved. */
export interface TrailDef {
  id: string;
  kind: 'main' | 'branch' | 'shortcut';
  /** World XZ waypoints the route must pass through (first = start, last = end). */
  waypoints: [number, number][];
  /** Snap the first/last waypoint onto another trail (junctions). */
  startOn?: string;
  endOn?: string;
  /** Width range (m); the width varies smoothly along the trail and widens in hairpins. */
  width: [number, number];
  /** Preferred and maximum average grade of the route (0.12 = 12 %). */
  targetGrade: number;
  maxGrade: number;
}

/** Kinds of landform the mountain is assembled from (see src/terrain/landforms.ts). */
export type LandformKind =
  | 'ridge'
  | 'valley'
  | 'cirque'
  | 'plateau'
  | 'meadow'
  | 'saddle'
  | 'slope'
  | 'hills'
  | 'moraine'
  | 'basin';

/**
 * One landform: a shape blended into the massif with smooth min/max (never a hard seam).
 * Point landforms use `at`, linear ones use `path`. Applied in array order.
 */
export interface LandformDef {
  kind: LandformKind;
  /** Centre (plateau, meadow, cirque, saddle, hills, basin). */
  at?: [number, number];
  /** Polyline (ridge, valley, slope), from the high end to the low end for valleys. */
  path?: [number, number][];
  /** Radius, or half width for linear landforms (m). */
  radius: number;
  /**
   * ridge/hills: amplitude; valley/cirque/saddle/basin: depth below the surroundings;
   * plateau/meadow: offset from the natural altitude at the centre; slope: step height (m).
   */
  height: number;
  /** Width of the smooth blend (m). */
  blend?: number;
  /** 0..1 detail amplitude and rockiness (crests, cirque walls) – 0 for smooth meadows. */
  rugged?: number;
  /** valley/cirque/basin: wall steepness (rise/run). */
  wall?: number;
}

/** Simplified erosion passes run on the generated heightmap. */
export interface ErosionDef {
  /** Thermal erosion: iterations and talus slope (rise/run) above which material slides. */
  thermalIterations: number;
  talus: number;
  /** Stream-power incision: passes and strength (0 disables). */
  hydraulicPasses: number;
  hydraulicStrength: number;
  /** Smoothing of valley floors where flow accumulates (0..1). */
  floorSmoothing: number;
  /** Particle (droplet) hydraulic erosion: droplets per km² and strength (0 disables). */
  droplets: number;
  dropletStrength: number;
}

/**
 * Relief at the intermediate scale (tens to hundreds of metres), shaped by zone: nothing
 * on declared flats (meadows, terraces, valley floors), rolling hummocks on gentle ground,
 * spurs, smoothed terrace steps and gullies on slopes, more on rugged ground.
 */
export interface ReliefDef {
  /** Domain warp of the relief noises (m, scale m). */
  warp: { amplitude: number; scale: number };
  /** Ridged multifractal spurs and small crests on slopes. */
  spurs: { amplitude: number; scale: number };
  /** Smoothed steps on slopes, in patches: step height (m), blend (0..1), patch scale (m). */
  terraces: { step: number; amount: number; scale: number };
  /** Rolling bumps and hollows on gentle ground (also the natural ramps for jumps). */
  hummocks: { amplitude: number; scale: number };
  /** Gullies carved where flow gathers on slopes: depth (m) at full flow. */
  gullies: { depth: number };
}

export interface RiverDef {
  /** Spring position; the stream follows the steepest descent down to the lake. */
  spring: [number, number];
  width: number;
  depth: number;
}

/** Altitudes (m) of the biome bands, from the top. Bands wobble slightly to look organic. */
export interface BiomeDef {
  snowLine: number;
  /** Above: bare rock, scree and alpine grass; below: meadows. */
  rockLine: number;
  treeLine: number;
  /** Below: dense forest. */
  denseForestLine: number;
  /** Below: valley meadows near the base. */
  valleyLine: number;
}

export interface MountainDef {
  id: string;
  nameKey: string;
  descriptionKey: string;
  seed: number;
  /** Half size of the playable map (m): 4000 → 8 × 8 km. */
  halfSize: number;
  summit: { x: number; z: number; height: number; plateauRadius: number };
  /** Altitude of the valley floor at the foot of the massif. */
  baseHeight: number;
  /** Extent of the massif from the summit in each direction (m). */
  radii: { north: number; south: number; east: number; west: number };
  /**
   * Radial profile of the massif: [normalised distance from the summit (0..1), height
   * fraction (1 = summit, 0 = valley floor)] keyframes, monotone cubic interpolation. Flat
   * stretches become terraces, steep ones faces.
   */
  profile: [number, number][];
  /**
   * How much of the massif follows the stepped profile rather than an even slope, mixed by
   * a large-scale noise (`scale` m) so terraces come and go around the mountain (0..1).
   */
  terracing: { amount: number; scale: number };
  noise: {
    /** Domain warping strength (m) and scale (m): organic outlines for terraces and faces. */
    warp: number;
    warpScale: number;
    /** Broad undulations baked in the heightmap. */
    broad: { amplitude: number; scale: number };
    /** Analytic low-amplitude detail added on top of the heightmap (rugged zones get more). */
    detail: { amplitude: number; rugged: number; scale: number };
  };
  /** Landforms blended into the massif, in order. */
  landforms: LandformDef[];
  /**
   * Distant ranges beyond the map (landforms too, usually large ridges): only the far-field
   * ring shows them, they never touch the playable terrain.
   */
  farRanges?: LandformDef[];
  relief: ReliefDef;
  erosion: ErosionDef;
  /** Natural boundary: ridges rising towards the map edge (m). */
  rimHeight: number;
  lake: { x: number; z: number; radius: number; level: number };
  rivers: RiverDef[];
  biomes: BiomeDef;
  trails: TrailDef[];
  /** Arrival zone at the base (village) and the start overlook on the summit. */
  base: { x: number; z: number; radius: number };
  start: { x: number; z: number };
  props: { trees: number; rocks: number; bushes: number };
  hazards: HazardPlacement[];
  collectibles: { coins: number; crystals: number };
  defaultTime: TimeOfDayId;
  defaultWeather: WeatherId;
  /** Medal thresholds in style score (higher is better). */
  medals: { gold: number; silver: number; bronze: number };
  /** Mountain id that must be descended once before this one unlocks. */
  unlockAfter?: string;
  /** Optional objectives for this descent (the daily challenge draws three). */
  objectives?: ObjectiveDef[];
}

export type SystemId =
  | 'nitro'
  | 'style'
  | 'hazards'
  | 'collectibles'
  | 'trees'
  | 'objectives'
  | 'medals'
  | 'achievements';

export type ModeId = 'freeDescent' | 'daily';

export interface ModeDef {
  id: ModeId;
  nameKey: string;
  descriptionKey: string;
  systems: SystemId[];
  /** Whether best scores are saved. */
  recordsEnabled: boolean;
  /** Medals from the style score (mountain thresholds) or from objectives completed (1/2/3). */
  medalsBy: 'score' | 'objectives';
}

export interface AchievementStats {
  runsFinished: number;
  totalDistance: number;
  bestAirTime: number;
  totalFlips: number;
  totalCoins: number;
  bestCombo: number;
  longestDrift: number;
  goldMedals: number;
  nearMisses: number;
  crystals: number;
}

export interface AchievementDef {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: string;
  reward: number;
  /** Returns true when unlocked. */
  check(stats: AchievementStats): boolean;
}
