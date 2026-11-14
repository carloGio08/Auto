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
    angularDamping: 0.8,
    /** Restitution / friction of chassis-vs-ground impacts. */
    chassisRestitution: 0,
    chassisFriction: 0.55,
    /** Restitution of chassis-vs-prop collisions. */
    propRestitution: 0.05,
    /** Water: extra linear drag per second when submerged, and buoyancy. */
    waterDrag: 2.6,
    waterBuoyancy: 0.9,
    /** Ground stick: seconds to reach full strength after landing / to fade out in the air. */
    stickRampIn: 0.35,
    stickAirDecay: 0.3,
    /** Roll (rad) relative to the ground beyond which the anti-flip assist pushes back. */
    antiFlipRoll: 0.45,
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
    slipPeak: 0.2,
    /** Lateral grip fraction when sliding beyond the peak. */
    slideFactor: 0.84,
    /** How fast lateral grip falls past the peak (per unit of normalised slip): low = tolerant. */
    slideFalloff: 0.18,
    /** Low speed threshold under which lateral sliding is cancelled (m/s). */
    lowSpeedCancel: 3,
    /** Rear lateral grip multiplier while the handbrake is held. */
    handbrakeGrip: 0.42,
    /** Yaw acceleration from steering while the handbrake is held (rad/s²): the drift flick. */
    handbrakeYaw: 2.2,
    /** Yaw torque assist while drifting, makes drifts easier to hold (N·m per rad of slip). */
    driftAssist: 2.0,
    /**
     * Global speed multiplier of every jeep: engine power × k and aerodynamic drag ÷ k², so
     * the top speed (power-limited, v³ ∝ power / drag) scales by k. 1.35 = 35 % faster.
     */
    speedScale: 1.35,
    /** Global grip multiplier – raise for more control, lower for more chaos. */
    gripScale: 1.05,
    /** Rolling resistance coefficient. */
    rollingResistance: 0.012,
    /** Reverse engages when braking below this speed (m/s). */
    reverseThreshold: 1.2,
  },

  camera: {
    /** Chase camera: high and far, so the slope ahead is visible. */
    chaseDistance: 9.5,
    chaseHeight: 3.9,
    wideDistance: 15,
    wideHeight: 7,
    /** Base look-ahead (m); grows with speed. */
    chaseLookAhead: 8,
    chaseStiffness: 5,
    /** Heading spring: lower = more lag in drifts. */
    chaseRotStiffness: 3.2,
    /** Low-pass of the jeep's height (bumps do not shake the camera). */
    verticalStiffness: 3.5,
    lookStiffness: 7,
    /** Max share of the travel direction in the heading (vs the nose). */
    velocityFollow: 0.7,
    /** Extra height (m) per unit of downhill grade ahead. */
    descentLift: 5,
    groundClearance: 1.4,
    /** Free look: seconds before auto-recentring, and recentring speed. */
    lookRecenterDelay: 1.2,
    lookRecenterRate: 2.5,
    fovBase: 62,
    fovMax: 78,
    /** Speed (m/s) at which the FOV reaches fovMax. */
    fovSpeed: 45,
    shakeLanding: 0.35,
    shakeCrash: 0.6,
    shakeNitro: 0.06,
    /** Opening fly-over length (s); skippable. */
    introDuration: 6.5,
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
    /**
     * Terrain LOD rings beyond LOD0 (whose face size and radius come from the quality
     * preset): target face size (m) up to each radius (m). Actual faces are the closest
     * power-of-two multiple of the LOD0 size, at most `lodTolerance` × the target.
     */
    lod: {
      lod1Cell: 2.5,
      lod1Radius: 600,
      lod2Cell: 6,
      lod2Radius: 1500,
      lod3Cell: 16,
      lod3Radius: 3500,
      lod4Cell: 48,
    },
    lodTolerance: 1.45,
    /** Deterministic XZ jitter of terrain vertices (fraction of a cell): breaks stripes. */
    terrainJitter: 0.25,
    /** Baked ambient occlusion: darkening strength (0 = off) and ring radii (m). */
    ao: { strength: 0.32, radii: [6, 18] as number[] },
    /**
     * Visibility fog on a clear day: nothing within `fogStart` m, then the scene fades into
     * the horizon colour, 63 % at start + V and 95 % at start + 1.7 V (thinner on high peaks).
     * Foggier weather divides both by √fogDensity.
     */
    fogVisibility: 650,
    fogStart: 300,
    /**
     * Baked wheel ruts along every trail: centre ±offset m from the spline, depth range (m,
     * tiny: no effect on handling), and the crisp ribbons drawn near the camera (radius,
     * rebuild step and lift in m, opacity).
     */
    ruts: {
      offset: 0.85,
      depth: [0.03, 0.05] as number[],
      radius: 230,
      rebuildStep: 24,
      lift: 0.05,
      opacity: 0.7,
    },
    /** Saturation multiplier applied to the whole palette (1 = as declared). */
    vividness: 1.15,
    /** Max ms per frame spent building terrain patches on the main thread (no worker). */
    chunkBuildBudgetMs: 4,
    /** Ground cover (grass, flowers, pebbles...) is generated per tile of this size (m). */
    coverTileSize: 64,
    /** Props are generated and instanced per cell of this size (m). */
    propCellSize: 320,
    /** Tree and rock colliders exist only within this distance of the jeep (m). */
    colliderRadius: 180,
    roadSampleSpacing: 2,
    /** Minimum width of the soft embankment beside a trail (m) and centre crown (m). */
    roadShoulder: 9,
    roadCrown: 0.1,
    /** Broken tree pieces alive at once, and seconds before they fade away. */
    debrisMax: 60,
    debrisLifetime: 20,
  },

  graphics: {
    presets: {
      low: {
        /** Terrain LOD0: face size (m), ring radius (m) and triangle budget. */
        terrainCell: 2,
        lod0Radius: 160,
        triangleBudget: 650_000,
        /** Cells per patch side at most (smaller patches: less waste, more draw calls). */
        patchCells: 48,
        pixelRatioCap: 1.5,
        shadows: true,
        shadowMapSize: 1024,
        antialias: true,
        viewDistance: 1500,
        propDistance: 420,
        /** Trees: detailed within (m), canopy masses up to (m), undergrowth within (m),
         * visible trees and canopy masses at most. */
        treeNear: 90,
        canopyDistance: 1500,
        undergrowthDistance: 60,
        /** Ground cover caps (instances) and grass/flower wind. */
        grassLimit: 4000,
        flowerLimit: 800,
        coverLimit: 1000,
        wind: false,
        treeLimit: 1500,
        canopyLimit: 3000,
        /** Far-field ring: grid spacing (m) and half extent (m). */
        farSpacing: 192,
        farExtent: 12000,
        propDensity: 0.5,
        particles: 400,
        clouds: 6,
      },
      medium: {
        /** Terrain LOD0: face size (m), ring radius (m) and triangle budget. */
        terrainCell: 1.25,
        lod0Radius: 180,
        triangleBudget: 1_300_000,
        patchCells: 64,
        pixelRatioCap: 2,
        shadows: true,
        shadowMapSize: 1024,
        antialias: true,
        viewDistance: 2300,
        propDistance: 650,
        /** Trees: detailed within (m), canopy masses up to (m), undergrowth within (m),
         * visible trees and canopy masses at most. */
        treeNear: 130,
        canopyDistance: 2400,
        undergrowthDistance: 100,
        /** Ground cover caps (instances) and grass/flower wind. */
        grassLimit: 12000,
        flowerLimit: 3000,
        coverLimit: 2500,
        wind: true,
        treeLimit: 3500,
        canopyLimit: 6000,
        /** Far-field ring: grid spacing (m) and half extent (m). */
        farSpacing: 128,
        farExtent: 16000,
        propDensity: 0.75,
        particles: 900,
        clouds: 10,
      },
      high: {
        /** Terrain LOD0: face size (m), ring radius (m) and triangle budget. */
        terrainCell: 0.85,
        lod0Radius: 200,
        triangleBudget: 1_800_000,
        patchCells: 96,
        pixelRatioCap: 2,
        shadows: true,
        shadowMapSize: 2048,
        antialias: true,
        viewDistance: 3200,
        propDistance: 900,
        /** Trees: detailed within (m), canopy masses up to (m), undergrowth within (m),
         * visible trees and canopy masses at most. */
        treeNear: 180,
        canopyDistance: 3200,
        undergrowthDistance: 140,
        /** Ground cover caps (instances) and grass/flower wind. */
        grassLimit: 30000,
        flowerLimit: 8000,
        coverLimit: 5000,
        wind: true,
        treeLimit: 8000,
        canopyLimit: 9000,
        /** Far-field ring: grid spacing (m) and half extent (m). */
        farSpacing: 112,
        farExtent: 20000,
        propDensity: 1,
        particles: 1600,
        clouds: 16,
      },
    },
    dynamicResolution: {
      /** Never below 0.85: blur is not an acceptable way to save frame time. */
      minScale: 0.85,
      targetMs: 16.9,
      downMs: 18.8,
      upMs: 14.5,
      /** Seconds between adjustments. */
      interval: 1,
    },
    /** Grade after ACES tone mapping: saturation and contrast multipliers (1 = neutral). */
    grade: { saturation: 1.12, contrast: 1.07 },
    /**
     * Shadow frustum half-size (m), centred `shadowAhead` m in front of the car along the view
     * so the road ahead gets shadows; bias tuned for the terrain (no acne, no peter-panning).
     */
    shadowExtent: 75,
    shadowAhead: 40,
    shadowBias: -0.00035,
    shadowNormalBias: 0.05,
  },

  audio: {
    masterDefault: 0.8,
    musicDefault: 0.45,
    sfxDefault: 0.85,
    engineIdleRpm: 900,
    engineMaxRpm: 7200,
    gearRatios: [0.0, 0.22, 0.38, 0.55, 0.74, 1.0] as const,
  },

  /**
   * Development helpers. BEFORE RELEASE set `testCoins` to 0 and `unlockAll` to false (see
   * README, "Before release").
   */
  dev: {
    /** Coins given to new profiles and to existing saves (migration), and the settings
     * button "Test: reset coins". 0 disables all of it. */
    testCoins: 100000 as number,
    /** Lets achievement-locked jeeps be bought for testing. */
    unlockAll: true as boolean,
  },

  /** Visual benchmark view (`?shot=benchmark`): fixed point of the main trail and look. */
  benchmark: {
    /** Metres from the summit along the main trail. */
    trailDistance: 9200,
    time: 'day' as const,
    weather: 'clear' as const,
  },

  /** Feature flags: toggle whole features without touching code. */
  features: {
    dynamicResolution: true,
    speedLines: true,
    music: true,
    tilt: true,
    haptics: true,
    /** Tyre tracks laid on the terrain (quality chosen in the settings). */
    tireTracks: true,
    /** Cinematic fly-over onto the summit at the start of a descent. */
    introFlyover: true,
    /** Shows an FPS / physics overlay (also toggled with F3). */
    debugOverlay: false,
    serviceWorker: true,
  },
} as const;

export type Config = typeof config;
export type QualityPresetId = keyof Config['graphics']['presets'];
export type QualityPreset = Config['graphics']['presets'][QualityPresetId];
