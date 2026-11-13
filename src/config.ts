/**
 * Every tuning number of the game lives here, grouped by area.
 * Car-specific values live in src/data/cars; these are global multipliers and engine settings.
 */
export const config = {
  physics: {
    /** Fixed simulation rate (Hz). */
    hz: 120,
    /** Gravity (m/s²). Higher than 9.81 makes jumps snappier and less floaty. */
    gravity: 15,
    /** Hard speed clamp (m/s) – safety only, drag limits real top speed. */
    maxSpeed: 90,
    /** Angular velocity clamp (rad/s). */
    maxAngularSpeed: 16,
    /** Angular damping applied every step (per second). */
    angularDamping: 0.6,
    /** Restitution / friction of chassis-vs-ground impacts. */
    chassisRestitution: 0.12,
    chassisFriction: 0.55,
    /** Restitution of chassis-vs-prop collisions. */
    propRestitution: 0.25,
    /** Water: extra linear drag per second when submerged, and buoyancy. */
    waterDrag: 2.6,
    waterBuoyancy: 0.9,
  },

  driving: {
    /** Steering: how fast the wheels turn towards input (rad/s) and return to centre. */
    steerRate: 3.2,
    steerReturnRate: 4.5,
    /** Speed (m/s) at which steering reaches its minimum angle factor. */
    steerFalloffSpeed: 38,
    /** Steering angle multiplier at/above steerFalloffSpeed. */
    minSteerFactor: 0.3,
    /** Slip angle (rad) where lateral grip peaks. */
    slipPeak: 0.17,
    /** Lateral grip fraction when sliding beyond the peak. */
    slideFactor: 0.78,
    /** Low speed threshold under which lateral sliding is cancelled (m/s). */
    lowSpeedCancel: 3,
    /** Rear lateral grip multiplier while the handbrake is held. */
    handbrakeGrip: 0.3,
    /** Yaw acceleration from steering while the handbrake is held (rad/s²): the drift flick. */
    handbrakeYaw: 2.6,
    /** Yaw torque assist while drifting, makes drifts easier to hold (N·m per rad of slip). */
    driftAssist: 2.4,
    /** Global grip multiplier – raise for more control, lower for more chaos. */
    gripScale: 1.0,
    /** Rolling resistance coefficient. */
    rollingResistance: 0.012,
    /** Reverse engages when braking below this speed (m/s). */
    reverseThreshold: 1.2,
  },

  camera: {
    chaseDistance: 7.2,
    chaseHeight: 2.6,
    chaseLookAhead: 6,
    chaseStiffness: 6,
    chaseRotStiffness: 4,
    highDistance: 13,
    highHeight: 8.5,
    fovBase: 62,
    fovMax: 84,
    /** Speed (m/s) at which the FOV reaches fovMax. */
    fovSpeed: 48,
    shakeLanding: 0.35,
    shakeCrash: 0.6,
    shakeNitro: 0.06,
  },

  gameplay: {
    /** Seconds within which a new trick keeps the combo alive. */
    comboWindow: 2.6,
    comboMaxMultiplier: 8,
    /** Minimum air time (s) that counts as a jump. */
    minAirTime: 0.45,
    /** Minimum slip angle (rad) and speed (m/s) for drifting. */
    driftAngle: 0.28,
    driftMinSpeed: 9,
    /** Near miss: distance from collider surface (m) and minimum speed (m/s). */
    nearMissDistance: 1.6,
    nearMissMinSpeed: 16,
    /** Impact speed (m/s) above which a collision is a crash (combo lost, shake). */
    crashImpactSpeed: 9,
    /** Landing counts as perfect when the car is within this angle of the ground normal. */
    perfectLandingAngle: 0.3,
    /** Nitro tank (seconds of boost) and refill rates. */
    nitro: {
      startAmount: 0.35,
      driftRefillPerSecond: 0.12,
      airRefillPerSecond: 0.1,
      nearMissRefill: 0.08,
      flipRefill: 0.2,
      perfectLandingRefill: 0.1,
      crystalRefill: 0.25,
    },
    /** Score → coins conversion at the end of a run. */
    coinsPerThousandScore: 12,
    coinValue: 5,
    crystalScore: 250,
    /** Minimum seconds between two resets. */
    resetCooldown: 0.6,
    /** Safe respawn spots: sampling interval (s), history length, stability limits. */
    safeSpot: {
      interval: 2,
      history: 6,
      maxSpeed: 30,
      minUp: 0.85,
      minGroundNormalY: 0.82,
    },
    /** Automatic reset: upside-down and stopped (s), deep water (s), lost off the map (s). */
    autoReset: { upsideDown: 4, water: 1.5, offMap: 0.5 },
  },

  world: {
    /** Terrain chunk size (m) and cell sizes per LOD (m). */
    chunkSize: 128,
    lodCellSizes: [4, 8, 16] as const,
    /** Distance thresholds (m) for LOD0 / LOD1; beyond → LOD2. */
    lodDistances: [190, 420] as const,
    /** Skirt depth hiding cracks between LODs (m). */
    skirtDepth: 8,
    /** Max ms per frame spent building terrain chunks. */
    chunkBuildBudgetMs: 5,
    /** Props are instanced per cell of this size (m). */
    propCellSize: 192,
    roadSampleSpacing: 2,
    roadShoulder: 9,
    roadCrown: 0.12,
    /** Road ribbon offset above terrain (m) to avoid z-fighting. */
    roadOffset: 0.06,
  },

  graphics: {
    presets: {
      low: {
        pixelRatioCap: 1,
        shadows: false,
        shadowMapSize: 512,
        antialias: false,
        viewDistance: 460,
        propDistance: 230,
        propDensity: 0.55,
        particles: 400,
        clouds: 6,
      },
      medium: {
        pixelRatioCap: 1.5,
        shadows: true,
        shadowMapSize: 1024,
        antialias: false,
        viewDistance: 760,
        propDistance: 380,
        propDensity: 0.8,
        particles: 900,
        clouds: 10,
      },
      high: {
        pixelRatioCap: 2,
        shadows: true,
        shadowMapSize: 2048,
        antialias: true,
        viewDistance: 1000,
        propDistance: 520,
        propDensity: 1,
        particles: 1600,
        clouds: 16,
      },
    },
    dynamicResolution: {
      minScale: 0.55,
      targetMs: 16.9,
      downMs: 18.8,
      upMs: 14.5,
      /** Seconds between adjustments. */
      interval: 1,
    },
    /** Shadow frustum half-size around the car (m). */
    shadowExtent: 55,
  },

  audio: {
    masterDefault: 0.8,
    musicDefault: 0.45,
    sfxDefault: 0.85,
    engineIdleRpm: 900,
    engineMaxRpm: 7200,
    gearRatios: [0.0, 0.22, 0.38, 0.55, 0.74, 1.0] as const,
  },

  /** Feature flags: toggle whole features without touching code. */
  features: {
    dynamicResolution: true,
    speedLines: true,
    music: true,
    tilt: true,
    haptics: true,
    skidmarks: true,
    /** Shows an FPS / physics overlay (also toggled with F3). */
    debugOverlay: false,
    serviceWorker: true,
  },
} as const;

export type Config = typeof config;
export type QualityPresetId = keyof Config['graphics']['presets'];
export type QualityPreset = Config['graphics']['presets'][QualityPresetId];
