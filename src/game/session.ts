import { Vector3 } from 'three';
import { config } from '../config';
import type { GameContext } from '../core/context';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { MedalId } from '../core/save';
import { timesOfDay, weathers } from '../data/environment';
import type { ModeDef, TimeOfDayId, TrackDef, WeatherId } from '../data/types';
import { Course } from '../terrain/course';
import { createRoadPoint, createRoadQuery } from '../terrain/road';
import { createGroundSample } from '../terrain/terrain';
import { World, type BuildStep } from '../world/world';
import { applyUpgrades, Vehicle } from '../vehicle/vehicle';
import { CameraRig } from '../vehicle/cameraRig';
import type { Autopilot } from '../vehicle/autopilot';
import { createSystem } from '../systems';
import type { GameSystem } from '../systems/system';
import { Effects } from '../effects/effects';
import { AudioDirector } from '../audio/director';
import type { DriveState } from '../input/actions';

export interface RunConfig {
  track: TrackDef;
  mode: ModeDef;
  carId: string;
  time: TimeOfDayId;
  weather: WeatherId;
}

export type RunPhase = 'countdown' | 'running' | 'finished' | 'timeout';

export interface RunSummary {
  finished: boolean;
  time: number;
  score: number;
  medal: MedalId;
  coinsEarned: number;
  crystals: number;
  newRecord: boolean;
  previousBest: number | null;
  topSpeed: number;
  bestAir: number;
  extra: { label: string; value: string }[];
}

const tmpV = new Vector3();

/**
 * Everything that exists for one run on one track: world, vehicle, camera, effects, audio
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

  phase: RunPhase = 'countdown';
  countdown = config.gameplay.countdown;
  /** Elapsed racing time (s). */
  time = 0;
  /** Remaining time in timed modes (s). */
  timeLeft: number;
  score = 0;
  coins = 0;
  crystals = 0;
  /** Furthest distance reached along the road (m) and the respawn point. */
  progressS: number;
  respawnS: number;
  finishTimer = 0;
  summary: RunSummary | null = null;
  /** Set by the medals system on finish. */
  medal: MedalId = 'none';
  /** Drive input actually applied (after countdown/finish overrides). */
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
  private offRoadTime = 0;
  private slowMoLeft = 0;
  private resetCooldown = 0;
  private lastCountdownValue = -1;
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
    const car = ctx.registries.cars.get(cfg.carId);
    const physics = applyUpgrades(car, ctx.registries.upgrades.all(), save.upgrades[car.id] ?? {});
    const color = save.carColors[car.id] ?? car.look.colors[0];
    this.vehicle = new Vehicle(car, physics, color, this.events);
    this.vehicle.physics.weatherGrip = world.weather.gripMultiplier;
    world.scene.add(this.vehicle.model.root, this.vehicle.model.shadow);
    this.vehicle.model.enableHeadlights(world.time.headlights);
    this.camera = new CameraRig(ctx.renderer.width / ctx.renderer.height);
    this.camera.mode = save.settings.camera;
    this.effects = new Effects(this, ctx.renderer.preset);
    this.audio = new AudioDirector(ctx.audio, this.events);
    this.timeLeft = cfg.mode.timed ? cfg.track.startTime : Infinity;
    this.progressS = course.startS;
    this.respawnS = course.startS;
    this.placeCar(course.startS);
    this.createSystems();
    this.offs.push(
      this.events.on('style:comboBanked', ({ points }) => (this.score += points)),
      this.events.on('collectible:picked', ({ kind, value }) => {
        if (kind === 'coin') this.coins += value;
        else this.crystals++;
      }),
      this.events.on('fx:slowmo', ({ duration, scale }) => {
        if (!config.features.slowMotion) return;
        this.slowMoLeft = duration;
        this.ctx.loop.timeScale = scale;
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
    yield { stage: 'loading.terrain', progress: 0 };
    const course = new Course(cfg.track);
    const world = new World({
      course,
      time: timesOfDay[cfg.time],
      weather: weathers[cfg.weather],
      preset: ctx.renderer.preset,
    });
    for (const step of world.build()) yield step;
    yield { stage: 'loading.vehicle', progress: 0.95 };
    return new RunSession(ctx, cfg, course, world);
  }

  private createSystems(): void {
    for (const id of this.cfg.mode.systems) {
      if (id === 'ghost' && !config.features.ghost) continue;
      const sys = createSystem(id);
      sys.init(this);
      this.systems.push(sys);
    }
  }

  /** Puts the car at rest on the road at distance s. */
  private placeCar(s: number): void {
    const p = this.course.road.pointAt(s, createRoadPoint());
    const g = this.course.terrain.sample(p.x, p.z, p.y + 3, createGroundSample());
    this.vehicle.physics.reset(p.x, g.height + 0.75, p.z, Math.atan2(p.tx, p.tz), g.normal);
    this.vehicle.telemetry.reset();
    this.vehicle.sync(1, this.course.terrain, 0, false);
    this.camera.snap(this.vehicle, this.course.terrain);
  }

  get length(): number {
    return this.course.finishS - this.course.startS;
  }

  /** 0..1 progress for the altitude bar. */
  get progress(): number {
    return Math.min(1, Math.max(0, (this.progressS - this.course.startS) / this.length));
  }

  start(): void {
    this.audio.startEngine(this.vehicle);
  }

  /** Respawn at the last checkpoint. */
  respawn(manual: boolean): void {
    if (this.resetCooldown > 0 || this.phase === 'finished' || this.phase === 'timeout') return;
    this.resetCooldown = config.gameplay.resetCooldown;
    this.placeCar(this.respawnS);
    this.offRoadTime = 0;
    if (manual && this.cfg.mode.timed && this.phase === 'running')
      this.timeLeft = Math.max(0.5, this.timeLeft - config.gameplay.resetPenalty);
    this.events.emit('run:reset', { toCheckpoint: this.respawnS, manual });
    this.systems.forEach((s) => s.onReset?.());
  }

  fixedUpdate(dt: number, drive: DriveState): void {
    const v = this.vehicle;
    const inp = this.input;
    inp.hold = false;
    if (this.autopilot && this.phase === 'running')
      this.autopilot.drive(v.physics, this.progressS, inp);
    else {
      inp.throttle = drive.throttle;
      inp.brake = drive.brake;
      inp.steer = drive.steer;
      inp.handbrake = drive.handbrake;
      inp.nitro = drive.nitro;
    }
    if (this.phase === 'countdown') {
      // Hold the car with the handbrake (braking at rest would engage reverse).
      inp.throttle = 0;
      inp.brake = 0;
      inp.handbrake = false;
      inp.hold = true;
      inp.steer = 0;
      inp.nitro = false;
    } else if (this.phase !== 'running') {
      inp.throttle = 0;
      inp.brake = 0.5;
      inp.handbrake = false;
      inp.nitro = false;
    }
    const colliders = this.world.colliders;
    v.step(dt, inp, this.course.terrain, () => colliders.resolveVehicle(v.physics, this.time));
    if (v.physics.invalid) {
      this.placeCar(this.respawnS);
      return;
    }
    this.trackProgress(dt);
    for (const s of this.systems) s.fixedUpdate?.(dt);
    this.effects.fixedUpdate(dt);
  }

  private trackProgress(dt: number): void {
    const p = this.vehicle.physics.position;
    const q = this.course.road.query(p.x, p.z, this.q);
    if (this.phase === 'running') {
      if (q.found && q.distance < 45 && q.s > this.progressS - 40 && q.s < this.progressS + 330) {
        this.progressS = Math.max(this.progressS, q.s);
      }
      if (this.progressS >= this.course.finishS) this.finish();
    }
    // Automatic respawn when lost, drowned or stuck far off-road.
    const lost = !q.found || q.distance > 90;
    const drowned = this.vehicle.physics.submerged > 0.7;
    const terrainY = this.course.terrain.height(p.x, p.z);
    const below = p.y < terrainY - 4 && !(q.found && q.distance < q.halfWidth + 1);
    if (lost || drowned || below) this.offRoadTime += dt;
    else this.offRoadTime = Math.max(0, this.offRoadTime - dt);
    if (this.offRoadTime > (drowned ? 1.6 : 3)) this.respawn(false);
  }

  private finish(): void {
    if (this.phase !== 'running') return;
    this.phase = 'finished';
    this.events.emit('run:finish', { time: this.time, score: this.score });
  }

  update(dt: number, alpha: number): void {
    const realDt = this.ctx.loop.realDt;
    this.resetCooldown = Math.max(0, this.resetCooldown - dt);
    // Slow motion runs on real time.
    if (this.slowMoLeft > 0) {
      this.slowMoLeft -= realDt;
      if (this.slowMoLeft <= 0) this.ctx.loop.timeScale = 1;
    }
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const value = Math.ceil(this.countdown);
      if (value !== this.lastCountdownValue) {
        this.lastCountdownValue = value;
        this.events.emit('run:countdown', { value: Math.max(0, value) });
      }
      if (this.countdown <= 0) {
        this.phase = 'running';
        this.events.emit('run:start', { trackId: this.cfg.track.id, modeId: this.cfg.mode.id });
      }
    } else if (this.phase === 'running') {
      this.time += dt;
      if (this.cfg.mode.timed) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.phase = 'timeout';
          this.events.emit('run:timeout', { distance: this.progressS });
        }
      }
    } else {
      this.finishTimer += realDt;
    }
    const v = this.vehicle;
    v.sync(
      alpha,
      this.course.terrain,
      this.time,
      this.input.brake > 0.1 && this.phase !== 'countdown',
    );
    v.updateAudio();
    this.camera.update(realDt, v, this.course.terrain);
    for (const s of this.systems) s.update?.(dt, alpha);
    this.effects.update(dt, realDt);
    this.world.update(realDt, this.camera.camera.position, tmpV.copy(v.renderPosition));
  }

  /** Restarts the run on the same world (fast retry). */
  restart(): void {
    this.systems.forEach((s) => s.dispose());
    this.systems = [];
    this.phase = 'countdown';
    this.countdown = config.gameplay.countdown;
    this.lastCountdownValue = -1;
    this.time = 0;
    this.timeLeft = this.cfg.mode.timed ? this.cfg.track.startTime : Infinity;
    this.score = 0;
    this.coins = 0;
    this.crystals = 0;
    this.finishTimer = 0;
    this.summary = null;
    this.medal = 'none';
    this.progressS = this.course.startS;
    this.respawnS = this.course.startS;
    this.ctx.loop.timeScale = 1;
    this.slowMoLeft = 0;
    this.effects.clear();
    this.vehicle.telemetry.topSpeed = 0;
    this.vehicle.telemetry.bestAir = 0;
    this.placeCar(this.course.startS);
    this.createSystems();
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
