/**
 * Content type definitions. Everything the game can be extended with is described here as data.
 */

export type SurfaceId =
  'trail' | 'grass' | 'forest' | 'snow' | 'scree' | 'rock' | 'mud' | 'sand' | 'ice' | 'wood';

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

/** Keys of the world palette (src/data/palette.ts). */
export type PaletteKey =
  | 'snow'
  | 'rock'
  | 'scree'
  | 'alpine'
  | 'meadow'
  | 'forest'
  | 'denseForest'
  | 'trail'
  | 'sand'
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

export interface CliffDef {
  /** Centre, direction (radians from +Z towards +X) and length of the wall (m). */
  x: number;
  z: number;
  angle: number;
  length: number;
  /** Height of the step (m) and horizontal width over which it happens. */
  height: number;
  width: number;
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
  /** Ridges radiating from the summit. */
  spurs: { count: number; amplitude: number; twist: number };
  noise: {
    /** Domain warping strength (m) and scale (m). */
    warp: number;
    warpScale: number;
    low: { amplitude: number; scale: number };
    mid: { amplitude: number; scale: number };
  };
  /** Slope limit for normal terrain (rise/run); only cliffs exceed it. */
  maxSlope: number;
  cliffs: CliffDef[];
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
}

export type SystemId =
  'nitro' | 'style' | 'hazards' | 'collectibles' | 'trees' | 'medals' | 'achievements';

export type ModeId = 'freeDescent' | 'daily';

export interface ModeDef {
  id: ModeId;
  nameKey: string;
  descriptionKey: string;
  systems: SystemId[];
  /** Whether best scores are saved. */
  recordsEnabled: boolean;
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
