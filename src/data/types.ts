/**
 * Content type definitions. Everything the game can be extended with is described here as data.
 */

export type SurfaceId =
  'asphalt' | 'dirt' | 'gravel' | 'grass' | 'mud' | 'ice' | 'snow' | 'rock' | 'sand' | 'wood';

export interface SurfaceDef {
  id: SurfaceId;
  /** Friction multiplier (1 = dirt road baseline). */
  grip: number;
  /** Extra rolling resistance (fraction of weight). */
  rollingDrag: number;
  /** Visual tint applied to the road ribbon or particles. */
  color: string;
  /** Particle kind spawned when sliding / at speed. */
  particle: 'dust' | 'snow' | 'mud' | 'gravel' | 'none';
  /** Audio texture (0 = smooth, 1 = loud gravel crunch). */
  roughness: number;
  /** Random vertical bumpiness amplitude (m) felt by the suspension. */
  bumpiness: number;
}

export type DriveType = 'awd' | 'rwd' | 'fwd';
export type BodyStyle = 'rally' | 'buggy' | 'truck' | 'coupe';

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
  };
  aero: { drag: number; downforce: number };
  steering: { maxAngle: number };
  nitro: { force: number; capacity: number; burnRate: number };
  /** Multiplier applied to air control torques. */
  airControl: number;
}

export interface CarLookDef {
  body: BodyStyle;
  colors: string[];
  accent: string;
  spoiler: boolean;
  roofRack: boolean;
  /** Visual wheel width (m). */
  wheelWidth: number;
}

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

export interface SwitchbackLayout {
  kind: 'switchback';
  /** Number of traversing legs. */
  legs: number;
  /** Leg length range (m). */
  legLength: [number, number];
  /** Heading of the legs relative to the fall line (degrees, 90 = level traverse). */
  legHeading: number;
  hairpinRadius: number;
  /** Random lateral wiggle amplitude on legs (m). */
  wiggle: number;
  /** Straight run-in from the start (m) and final run-out to the finish (m). */
  runIn: number;
  runOut: number;
  /** First leg direction: 1 = towards +X, -1 = towards -X. */
  firstDirection: 1 | -1;
}

export interface PointsLayout {
  kind: 'points';
  points: [number, number][];
}

export type TrackLayout = SwitchbackLayout | PointsLayout;

export interface TerrainDef {
  summitHeight: number;
  /** Fall-line slope of the mountain face. */
  slope: number;
  ridgeAmplitude: number;
  noiseAmplitude: number;
  /** Altitude where snow starts (m). */
  snowLine: number;
  /** Lake water level (m) and radius. */
  lakeLevel: number;
  lakeRadius: number;
}

export interface RiverDef {
  /** X where the stream flows down the fall line. */
  x: number;
  /** Where the spring is, as a fraction of the course's Z extent (0 = start, 1 = finish). */
  from: number;
  width: number;
  depth: number;
  meander: number;
}

/** A position along the track expressed as a fraction of its length (0..1). */
export type TrackFraction = number;

export interface SurfaceZoneDef {
  from: TrackFraction;
  to: TrackFraction;
  surface: SurfaceId;
}

export interface JumpDef {
  at: TrackFraction;
  /** Kicker height (m) and ramp length (m). */
  height: number;
  length: number;
}

export interface ShortcutDef {
  /** Start and end along the road; the shortcut runs between them off-road. */
  from: TrackFraction;
  to: TrackFraction;
  surface: SurfaceId;
  /** Small kicker ramps along the shortcut. */
  kickers: number;
}

export type HazardKind = 'boulder' | 'rockslide' | 'log' | 'mudPool' | 'icePatch';

export interface HazardPlacement {
  kind: HazardKind;
  at: TrackFraction;
  /** Lateral offset from the road centre (m). */
  offset?: number;
}

export interface HazardDef {
  kind: HazardKind;
  nameKey: string;
  /** Distance ahead of the car (m along the road) at which it activates. */
  triggerDistance: number;
  /** Radius of the collider / zone (m). */
  radius: number;
  /** Surface applied by zone hazards. */
  surface?: SurfaceId;
}

export interface TrackDef {
  id: string;
  nameKey: string;
  descriptionKey: string;
  difficulty: 1 | 2 | 3;
  seed: number;
  layout: TrackLayout;
  roadWidth: number;
  terrain: TerrainDef;
  river?: RiverDef;
  /** Default road surface outside of zones. */
  roadSurface: SurfaceId;
  surfaces: SurfaceZoneDef[];
  jumps: JumpDef[];
  /** Bumpy "whoops" sections. */
  bumps: { from: TrackFraction; to: TrackFraction; amplitude: number }[];
  arch?: TrackFraction;
  shortcuts: ShortcutDef[];
  hazards: HazardPlacement[];
  collectibles: { coins: number; crystals: number };
  props: { trees: number; rocks: number; bushes: number };
  defaultTime: TimeOfDayId;
  defaultWeather: WeatherId;
  /** Medal thresholds in style score (higher is better). */
  medals: { gold: number; silver: number; bronze: number };
  /** Track id whose bronze medal unlocks this track. */
  unlockAfter?: string;
}

export type SystemId = 'nitro' | 'style' | 'hazards' | 'collectibles' | 'medals' | 'achievements';

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
