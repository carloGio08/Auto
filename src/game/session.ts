import type { ObjectiveDef } from '../data/objectives';
import { Vector3 } from 'three';
import { config } from '../config';
import type { GameContext } from '../core/context';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { MedalId } from '../core/save';
import { timesOfDay, weathers } from '../data/environment';
import type { ModeDef, TimeOfDayId, MountainDef, WeatherId } from '../data/types';
import { Course } from '../terrain/course';
import { createRoadPoint, createRoadQuery } from '../terrain/road';
import { createGroundSample } from '../terrain/terrain';
import { World, type BuildStep } from '../world/world';
import { applyUpgrades, Vehicle } from '../vehicle/vehicle';
import { configuredJeep } from './progression';
import { CameraRig } from '../vehicle/cameraRig';
import type { Autopilot } from '../vehicle/autopilot';
import { createSystem } from '../systems';
import type { GameSystem } from '../systems/system';
import { Effects } from '../effects/effects';
import { AudioDirector } from '../audio/director';
import type { DriveState } from '../input/actions';

export interface RunConfig {
  mountain: MountainDef;
  mode: ModeDef;
  carId: string;
  time: TimeOfDayId;
  weather: WeatherId;
}

export type RunPhase = 'running' | 'finished';

export interface RunSummary {
  finished: boolean;
  score: number;
  medal: MedalId;
  coinsEarned: number;
  crystals: number;
  newRecord: boolean;
  previousBest: number | null;
  topSpeed: number;
  bestAir: number;
  stats: DescentStats;
  extra: { label: string; value: string }[];
}

/** Numbers shown on the results screen (no times). */
export interface DescentStats {
  /** Metres driven. */
  distance: number;
  /** Altitude difference between the start and the lowest point reached. */
  altitudeDrop: number;
  treesBroken: number;
  longestDrift: number;
  longestJump: number;
}

/** Progress of one objective during a run. */
export interface ObjectiveState {
  def: ObjectiveDef;
  value: number;
  done: boolean;
}

/** A position where the car was stable, used for resets. */
export interface SafeSpot {
  x: number;
  y: number;
  z: number;
  heading: number;
}

const tmpV = new Vector3();
const tmpN = new Vector3();
const fwd = new Vector3();
const up = new Vector3();
const left = new Vector3();

/**
 * Everything that exists for one descent of a mountain: world, vehicle, camera, effects, audio
 * and the gameplay systems chosen by the mode. Created by the Loading state, driven by
 * the Playing state.
 */
export class RunSession {
  readonly events = new EventBus<GameEvents>();
  readonly course: Course;
  readonly world: World;
  readonly vehicle: Vehicle;
  readonly camera: CameraRig;
  readonly effects: Effects;
  readonly audio: AudioDirector;
  systems: GameSystem[] = [];

  phase: RunPhase = 'running';
  /** Elapsed simulation time (s); internal only, never shown as a timer. */
  time = 0;
  score = 0;
  coins = 0;
  crystals = 0;
  /** Furthest distance reached along the main trail (m), for the descent bar. */
  progressS: number;
  /** Recent safe spots, newest last. Resets go back through them. */
  readonly safeSpots: SafeSpot[] = [];
  finishTimer = 0;
  summary: RunSummary | null = null;
  readonly stats: DescentStats = {
    distance: 0,
    altitudeDrop: 0,
    treesBroken: 0,
    longestDrift: 0,
    longestJump: 0,
  };
  /** Set by the medals system on finish. */
  medal: MedalId = 'none';
  /** Filled by the objectives system (daily challenge). */
  objectives: ObjectiveState[] = [];
  /** Drive input actually applied (after finish overrides). */
  readonly input: DriveState & { hold: boolean } = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
    hold: false,
  };
  /** When set, an autopilot drives the car (e2e tests, `?autopilot`). */
  autopilot: Autopilot | null = null;
  private readonly q = createRoadQuery();
  private safeTimer = 0;
  private waterTime = 0;
  private offMapTime = 0;
  private resetCooldown = 0;
  /** Consecutive manual resets in a short time walk further back through the history. */
  private lastResetAt = -99;
  private resetDepth = 0;
  private readonly offs: (() => void)[] = [];

  private constructor(
    readonly ctx: GameContext,
    readonly cfg: RunConfig,
    course: Course,
    world: World,
  ) {
    this.course = course;
    this.world = world;
    const save = ctx.save.data;
    // The jeep as configured in the garage (accessories); paint and upgrades below.
    const car = configuredJeep(save, ctx.registries.cars.get(cfg.carId));
    const physics = applyUpgrades(car, ctx.registries.upgrades.all(), save.upgrades[car.id] ?? {});
    const color = save.carColors[car.id] ?? car.look.colors[0];
    this.vehicle = new Vehicle(car, physics, color, this.events);
    this.vehicle.physics.weatherGrip = world.weather.gripMultiplier;
    world.scene.add(this.vehicle.model.root, this.vehicle.model.shadow);
    this.vehicle.model.enableHeadlights(world.time.headlights);
    this.camera = new CameraRig(ctx.renderer.width / ctx.renderer.height);
    this.camera.mode = save.settings.camera;
    this.camera.syncPrefs(save.settings);
    this.camera.world = { colliders: world.colliders, props: world.props };
    this.effects = new Effects(this, ctx.renderer.preset);
    this.audio = new AudioDirector(ctx.audio, this.events);
    this.progressS = course.startS;
    this.placeAtStart();
    this.createSystems();
    this.offs.push(
      this.events.on('style:comboBanked', ({ points }) => (this.score += points)),
      this.events.on('collectible:picked', ({ kind, value }) => {
        if (kind === 'coin') this.coins += value;
        else this.crystals++;
      }),
      this.events.on('treeBroken', () => this.stats.treesBroken++),
      this.events.on('vehicle:drift', ({ duration }) => {
        this.stats.longestDrift = Math.max(this.stats.longestDrift, duration);
      }),
      this.events.on('vehicle:landed', ({ distance }) => {
        this.stats.longestJump = Math.max(this.stats.longestJump, distance);
      }),
      this.events.on('fx:shake', ({ amount }) => this.camera.addShake(amount)),
      this.events.on('vehicle:crash', ({ impact }) =>
        this.camera.addShake(Math.min(1, impact * 0.04)),
      ),
      this.events.on('vehicle:landed', ({ impact }) =>
        this.camera.addShake(Math.min(0.5, impact * 0.03)),
      ),
    );
  }

  /** Builds course, world and session incrementally (for the loading screen). */
  static *create(ctx: GameContext, cfg: RunConfig): Generator<BuildStep, RunSession> {
    // Heightmap, erosion and trail routing run in the terrain worker.
    const job = ctx.terrain.prepare(cfg.mountain);
    while (!job.done) yield { stage: 'loading.terrain', progress: job.progress * 0.3, wait: true };
    const data = job.data ?? ctx.terrain.getSync(cfg.mountain);
    const course = new Course(cfg.mountain, data);
    const world = new World({
      course,
      time: timesOfDay[cfg.time],
      weather: weathers[cfg.weather],
      preset: ctx.renderer.preset,
      terrain: ctx.terrain,
    });
    for (const step of world.build()) yield step;
    yield { stage: 'loading.vehicle', progress: 0.95 };
    return new RunSession(ctx, cfg, course, world);
  }

  private createSystems(): void {
    for (const id of this.cfg.mode.systems) {
      const sys = createSystem(id);
      sys.init(this);
      this.systems.push(sys);
    }
  }

  /** Puts the car at rest at the start of the main trail. */
  private placeAtStart(): void {
    const p = this.course.road.pointAt(this.course.startS, createRoadPoint());
    this.place({ x: p.x, y: p.y, z: p.z, heading: Math.atan2(p.tx, p.tz) }, true);
    this.safeSpots.length = 0;
    this.safeSpots.push({ x: p.x, y: p.y, z: p.z, heading: Math.atan2(p.tx, p.tz) });
  }

  private place(spot: SafeSpot, snapCamera: boolean, smooth = false): void {
    const g = this.course.terrain.sample(spot.x, spot.z, spot.y + 3, createGroundSample());
    this.vehicle.physics.reset(spot.x, g.height + 0.9, spot.z, spot.heading, g.normal);
    this.vehicle.telemetry.reset();
    this.vehicle.sync(1, this.course.terrain, 0, false);
    if (snapCamera) this.camera.snap(this.vehicle, this.course.terrain, smooth);
  }

  get length(): number {
    return this.course.finishS - this.course.startS;
  }

  /** Centre of the arrival zone at the base (compass target). */
  get base(): { x: number; y: number; z: number } {
    return this.course.base;
  }

  /** Altitude of the start (top of the descent bar). */
  get summitAltitude(): number {
    return this.course.startAltitude;
  }

  /** 0..1 progress along the main trail. */
  get progress(): number {
    return Math.min(1, Math.max(0, (this.progressS - this.course.startS) / this.length));
  }

  /** Seconds left of the opening fly-over (0 = driving). */
  intro = 0;
  private readonly introCentre = new Vector3();

  /** Starts the run, optionally with the cinematic fly-over onto the summit. */
  start(withIntro = true): void {
    this.audio.startEngine(this.vehicle);
    const d = this.course.def;
    this.introCentre.set(
      (d.summit.x + d.base.x) / 2,
      (this.course.startAltitude + this.course.base.y) / 2,
      (d.summit.z + d.base.z) / 2,
    );
    this.intro = withIntro && config.features.introFlyover ? config.camera.introDuration : 0;
    if (this.intro === 0) this.beginDriving();
  }

  /** Puts the jeep at a point facing `heading` with a forward speed (tests and tools). */
  teleport(x: number, z: number, heading: number, speed = 0): void {
    this.world.prebuildAround(x, this.course.terrain.height(x, z) + 4, z);
    this.place({ x, y: this.course.terrain.height(x, z), z, heading }, true);
    const ph = this.vehicle.physics;
    ph.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  }

  /** Ends the fly-over early (any key, button or tap). */
  skipIntro(): void {
    if (this.intro <= 0) return;
    this.intro = 0;
    this.beginDriving();
  }

  private beginDriving(): void {
    this.world.setFogScale(1);
    this.camera.snap(this.vehicle, this.course.terrain);
    this.events.emit('run:start', { trackId: this.cfg.mountain.id, modeId: this.cfg.mode.id });
  }

  /**
   * Puts the car back on the last safe spot, facing downhill. Pressing reset again shortly
   * after walks further back through the history (escape from bad spots).
   */
  respawn(manual: boolean): void {
    if (this.resetCooldown > 0 || this.phase === 'finished') return;
    this.resetCooldown = config.gameplay.resetCooldown;
    if (this.time - this.lastResetAt < 6) this.resetDepth++;
    else this.resetDepth = 0;
    this.lastResetAt = this.time;
    const n = this.safeSpots.length;
    const spot = this.safeSpots[Math.max(0, n - 1 - this.resetDepth)];
    this.place(spot, true, true);
    this.waterTime = 0;
    this.offMapTime = 0;
    this.events.emit('run:reset', { manual });
    this.systems.forEach((s) => s.onReset?.());
  }

  /** Samples a safe spot every few seconds while the car is stable on gentle dry ground. */
  private sampleSafeSpot(dt: number): void {
    const cfg = config.gameplay.safeSpot;
    this.safeTimer += dt;
    if (this.safeTimer < cfg.interval) return;
    const ph = this.vehicle.physics;
    ph.axes(fwd, up, left);
    if (
      ph.wheelsInContact < 3 ||
      up.y < cfg.minUp ||
      ph.speed > cfg.maxSpeed ||
      ph.submerged > 0 ||
      ph.angularVelocity.lengthSq() > 1.5
    )
      return;
    const p = ph.position;
    const terrain = this.course.terrain;
    terrain.normal(p.x, p.z, tmpN, p.y + 2);
    if (tmpN.y < cfg.minGroundNormalY) return;
    if (terrain.waterLevel(p.x, p.z) > terrain.groundHeight(p.x, p.z, p.y + 2) - 0.5) return;
    this.safeTimer = 0;
    // Face downhill: the horizontal component of the ground normal points down the slope.
    const downhill =
      Math.hypot(tmpN.x, tmpN.z) > 0.02 ? Math.atan2(tmpN.x, tmpN.z) : Math.atan2(fwd.x, fwd.z);
    this.safeSpots.push({ x: p.x, y: p.y, z: p.z, heading: downhill });
    if (this.safeSpots.length > cfg.history) this.safeSpots.shift();
  }

  fixedUpdate(dt: number, drive: DriveState): void {
    const v = this.vehicle;
    const inp = this.input;
    inp.hold = this.intro > 0;
    if (this.autopilot && this.phase === 'running')
      this.autopilot.drive(v.physics, this.progressS, inp);
    else {
      inp.throttle = drive.throttle;
      inp.brake = drive.brake;
      inp.steer = drive.steer;
      inp.handbrake = drive.handbrake;
      inp.nitro = drive.nitro;
    }
    if (this.phase !== 'running' || this.intro > 0) {
      inp.throttle = 0;
      inp.brake = 0.5;
      inp.handbrake = false;
      inp.nitro = false;
    }
    const colliders = this.world.colliders;
    v.step(dt, inp, this.course.terrain, () => colliders.resolveVehicle(v.physics, this.time));
    if (v.physics.invalid) {
      this.respawn(false);
      return;
    }
    this.trackProgress(dt);
    for (const s of this.systems) s.fixedUpdate?.(dt);
    this.effects.fixedUpdate(dt);
  }

  private trackProgress(dt: number): void {
    const ph = this.vehicle.physics;
    const p = ph.position;
    const q = this.course.road.query(p.x, p.z, this.q);
    if (this.phase === 'running') {
      // Progress along the main trail (only used for the autopilot and statistics).
      if (
        q.found &&
        q.trail === 0 &&
        q.distance < 60 &&
        q.s > this.progressS - 60 &&
        q.s < this.progressS + 600
      ) {
        this.progressS = Math.max(this.progressS, q.s);
      }
      // The descent ends when the car reaches the arrival zone at the base.
      if (this.course.inBase(p.x, p.z)) this.finish();
      this.sampleSafeSpot(dt);
      this.stats.altitudeDrop = Math.max(this.stats.altitudeDrop, this.summitAltitude - p.y);
    }
    // Automatic resets: upside down and stopped, deep water, lost off the map.
    const ar = config.gameplay.autoReset;
    const terrainY = this.course.terrain.height(p.x, p.z);
    const half = this.course.def.halfSize;
    const lost = Math.max(Math.abs(p.x), Math.abs(p.z)) > half * 1.02 || p.y < terrainY - 6;
    this.offMapTime = lost ? this.offMapTime + dt : 0;
    this.waterTime = ph.submerged > 0.7 ? this.waterTime + dt : 0;
    if (
      ph.upsideDownTime > ar.upsideDown ||
      this.waterTime > ar.water ||
      this.offMapTime > ar.offMap
    ) {
      this.respawn(false);
    }
  }

  private finish(): void {
    if (this.phase !== 'running') return;
    this.phase = 'finished';
    this.events.emit('run:finish', { score: this.score });
  }

  update(dt: number, alpha: number): void {
    const realDt = this.ctx.loop.realDt;
    this.resetCooldown = Math.max(0, this.resetCooldown - dt);
    if (this.phase === 'running' && this.intro <= 0) this.time += dt;
    else this.finishTimer += realDt;
    const v = this.vehicle;
    v.sync(alpha, this.course.terrain, this.time, this.input.brake > 0.1);
    v.updateAudio();
    this.camera.syncPrefs(this.ctx.save.data.settings);
    if (this.intro > 0) {
      // Clamped: the first frame after loading can report a long frame time.
      this.intro = Math.max(0, this.intro - Math.min(realDt, 0.05));
      const T = config.camera.introDuration;
      const t = 1 - this.intro / T;
      this.camera.intro(t, v, this.course.terrain, this.introCentre);
      this.world.setFogScale(1 + 1.6 * (1 - t) * (1 - t));
      if (this.intro === 0) this.beginDriving();
    } else this.camera.update(realDt, v, this.course.terrain, this.ctx.input.look);
    for (const s of this.systems) s.update?.(dt, alpha);
    this.effects.update(dt, realDt);
    this.world.update(
      realDt,
      this.camera.camera.position,
      tmpV.copy(v.renderPosition),
      this.intro > 0 ? 10 : undefined,
    );
  }

  /** Restarts the run on the same world (fast retry). */
  restart(): void {
    this.systems.forEach((s) => s.dispose());
    this.systems = [];
    this.phase = 'running';
    this.time = 0;
    this.score = 0;
    this.coins = 0;
    this.crystals = 0;
    this.finishTimer = 0;
    this.summary = null;
    this.medal = 'none';
    this.objectives = [];
    this.progressS = this.course.startS;
    Object.assign(this.stats, {
      distance: 0,
      altitudeDrop: 0,
      treesBroken: 0,
      longestDrift: 0,
      longestJump: 0,
    });
    this.vehicle.physics.odometer = 0;
    this.effects.clear();
    this.world.props.restoreTrees();
    this.vehicle.telemetry.topSpeed = 0;
    this.vehicle.telemetry.bestAir = 0;
    this.placeAtStart();
    this.createSystems();
    this.intro = 0;
    this.beginDriving();
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.systems.forEach((s) => s.dispose());
    this.systems = [];
    this.audio.dispose();
    this.effects.dispose();
    this.vehicle.dispose();
    this.world.dispose();
    this.events.clear();
    this.ctx.loop.timeScale = 1;
  }
}
