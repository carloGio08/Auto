import { DebugMap } from '../ui/debugMap';
import { DebugProbe } from '../ui/debugProbe';
import { benchmark } from '../core/benchmark';
import { config } from '../config';
import { createRoadPoint } from '../terrain/road';
import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { vibrate } from '../core/device';
import type { RunSession } from '../game/session';
import { finalizeRun, isMountainUnlocked } from '../game/progression';
import { Autopilot } from '../vehicle/autopilot';
import { TouchSource } from '../input/touch';
import { Hud } from '../ui/hud';
import { createDailyMountain, todayKey } from '../data/mountains';

/** Drives a RunSession: input, simulation, HUD, pause and the transition to results. */
export class PlayingState implements GameState<StateId> {
  readonly id = 'playing' as const;
  session!: RunSession;
  private hud!: Hud;
  private resultsShown = false;
  private paused = false;
  /** Benchmark view: physics frozen, the jeep stays parked. */
  private frozen = false;
  private readonly offs: (() => void)[] = [];
  /** Any tap/click skips the opening fly-over. */
  private readonly onSkipTap = (): void => {
    if (this.session?.intro > 0 && !this.paused) this.session.skipIntro();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden && !this.paused && this.session.phase !== 'finished') this.openPause();
  };
  /** Development map (F4 in dev builds or with ?debug). */
  private debugMap: DebugMap | null = null;
  /** Development probe (F6 in dev builds or with ?debug; ?probe shows it at start). */
  private probe: DebugProbe | null = null;
  private readonly onDebugKey = (e: KeyboardEvent): void => {
    if (!this.session) return;
    if (e.code === 'F6') {
      this.probe ??= new DebugProbe(this.session.course, this.session.world.cover);
      this.probe.toggle();
    }
    if (e.code !== 'F4') return;
    this.debugMap ??= new DebugMap(this.session.course);
    this.debugMap.toggle();
  };
  private readonly onResize = (): void =>
    this.session.camera.resize(this.ctx.renderer.width / this.ctx.renderer.height);

  constructor(private readonly ctx: GameContext) {}

  enter(params?: unknown): void {
    const ctx = this.ctx;
    this.session = (params as { session: RunSession }).session;
    ctx.view = { scene: this.session.world.scene, camera: this.session.camera.camera };
    ctx.input.drivingEnabled = true;
    ctx.ui.navEnabled = false;
    this.mountHud();
    if (ctx.device.touch && !ctx.input.has('touch') && this.hud.touch)
      ctx.input.add(new TouchSource(ctx.input, this.hud.el));
    if (ctx.save.data.settings.touchMode === 'tilt' && ctx.device.touch) {
      ctx.tilt.start();
      ctx.tilt.recenter();
      if (!ctx.input.has('tilt')) ctx.input.add(ctx.tilt);
    }
    if (new URLSearchParams(location.search).has('autopilot'))
      this.session.autopilot = new Autopilot(this.session.course.road);
    const query = new URLSearchParams(location.search);
    if (benchmark.active) {
      // Fixed view: default camera, no intro, jeep parked on the trail with physics frozen.
      const st = ctx.save.data.settings;
      Object.assign(st, { camera: 'chase', cameraDistance: 1, cameraHeight: 1, cameraShake: 0 });
      this.session.start(false);
      const spot = config.benchmark.spots[benchmark.spot];
      const p = this.session.course.road.pointAt(
        spot ? spot.s : config.benchmark.trailDistance,
        createRoadPoint(),
      );
      const lat = spot ? spot.lateral : 0;
      this.session.teleport(p.x + p.tz * lat, p.z - p.tx * lat, Math.atan2(p.tx, p.tz));
      this.session.camera.mode = 'chase';
      this.session.camera.snap(this.session.vehicle, this.session.course.terrain);
      this.frozen = true;
      document.documentElement.dataset.benchmark = 'running';
    } else this.session.start(!query.has('autopilot') && !query.has('e2e'));
    // Debug route (dev builds or ?debug): ?goto=x,z[,heading] jumps the jeep and camera.
    const go = query.get('goto');
    if (go && (import.meta.env.DEV || query.has('debug'))) {
      const [gx, gz, gh] = go.split(',').map(Number);
      if (Number.isFinite(gx) && Number.isFinite(gz)) {
        this.session.skipIntro();
        this.session.teleport(gx, gz, Number.isFinite(gh) ? gh : 0);
        this.session.camera.snap(this.session.vehicle, this.session.course.terrain);
      }
    }
    window.addEventListener('pointerdown', this.onSkipTap);
    this.offs.push(
      this.session.events.on(
        'haptic',
        ({ pattern }) => ctx.save.data.settings.haptics && vibrate(pattern),
      ),
    );
    this.offs.push(
      this.session.events.on(
        'vehicle:crash',
        ({ impact }) => ctx.save.data.settings.haptics && vibrate(Math.min(120, 20 + impact * 4)),
      ),
    );
    this.offs.push(
      this.session.events.on(
        'vehicle:landed',
        ({ impact }) => ctx.save.data.settings.haptics && impact > 3 && vibrate(25),
      ),
    );
    // Fine degradation steps of the automatic quality (weak devices).
    this.offs.push(ctx.renderer.onDegrade((level) => this.session.world.setDegrade(level)));
    if (ctx.renderer.degrade) this.session.world.setDegrade(ctx.renderer.degrade);
    // Quality changes (settings or automatic downgrade) apply to the running world.
    this.offs.push(
      ctx.renderer.onQualityChange(() => {
        this.session.world.setQuality(ctx.renderer.preset);
        this.session.effects.setQuality(ctx.renderer.preset);
      }),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
      window.addEventListener('keydown', this.onDebugKey);
      if (new URLSearchParams(location.search).has('probe')) {
        this.probe = new DebugProbe(this.session.course, this.session.world.cover);
        this.probe.toggle(true);
      }
    }
    // Debug hook for automated tests (dev builds or ?e2e only).
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
      const s = this.session;
      (window as unknown as { __md?: object }).__md = {
        session: s,
        /** Names of the worst-case richness spots. */
        spots: config.benchmark.spots.map((sp) => sp.name),
        /** Parks the jeep at worst-case richness spot `i` (config.benchmark.spots). */
        spot: (i: number) => {
          const sp = config.benchmark.spots[i];
          const p = s.course.road.pointAt(sp.s, createRoadPoint());
          s.teleport(p.x + p.tz * sp.lateral, p.z - p.tx * sp.lateral, Math.atan2(p.tx, p.tz));
          s.camera.snap(s.vehicle, s.course.terrain);
        },
        /** Renderer statistics of the last frame (draw calls, triangles). */
        renderInfo: () => ({ ...ctx.renderer.gl.info.render }),
        /** Drops the jeep inside the base zone: the run finishes on the next step. */
        finish: () => s.teleport(s.course.base.x, s.course.base.z, 0),
        /** Moves the jeep to a main-trail position (metres from the summit). */
        trail: (dist: number) => {
          const p = s.course.road.pointAt(dist, createRoadPoint());
          s.teleport(p.x, p.z, Math.atan2(p.tx, p.tz));
          s.progressS = dist;
        },
        /**
         * Drops the jeep off the trail: `lateral` metres to the side of main-trail position
         * `dist`, facing along the trail, with the autopilot off.
         */
        offroad: (dist: number, lateral: number) => {
          const p = s.course.road.pointAt(dist, createRoadPoint());
          s.autopilot = null;
          s.teleport(p.x + p.tz * lateral, p.z - p.tx * lateral, Math.atan2(p.tx, p.tz));
        },
        /** Launches the jeep at the nearest tree of a tier; returns its id or null. */
        aimAtTree: (tier: 'young' | 'medium' | 'old', speed = 14) => {
          const v = s.vehicle.physics.position;
          let best: { x: number; z: number; id: number } | null = null;
          let bd = Infinity;
          s.world.props.forEachTreeNear(v.x, v.z, 200, (t) => {
            const d = Math.hypot(t.x - v.x, t.z - v.z);
            if (t.tier === tier && d > 20 && d < bd) {
              bd = d;
              best = t;
            }
          });
          if (!best) return null;
          const tr = best as { x: number; z: number; id: number };
          const dx = tr.x - v.x;
          const dz = tr.z - v.z;
          const l = Math.hypot(dx, dz);
          s.teleport(tr.x - (dx / l) * 16, tr.z - (dz / l) * 16, Math.atan2(dx, dz), speed);
          return tr.id;
        },
      };
    }
  }

  private mountHud(): void {
    this.hud = new Hud(this.ctx, this.session, () => this.openPause());
    const layer = document.getElementById('hud') ?? document.body;
    layer.append(this.hud.el);
  }

  openPause(): void {
    if (this.paused || this.resultsShown) return;
    this.paused = true;
    this.ctx.states.push('paused', { playing: this });
  }

  pause(): void {
    this.ctx.input.drivingEnabled = false;
    this.ctx.ui.navEnabled = true;
    this.ctx.audio.setPaused(true);
    this.hud.el.classList.add('dim');
  }

  resume(): void {
    this.paused = false;
    if (this.resultsShown) return;
    this.ctx.input.drivingEnabled = true;
    this.ctx.ui.navEnabled = false;
    this.ctx.audio.setPaused(false);
    this.hud.el.classList.remove('dim');
  }

  restart(): void {
    this.resultsShown = false;
    this.paused = false;
    this.session.restart();
    this.hud.dispose();
    this.mountHud();
    const touch = this.ctx.input.has('touch');
    if (touch) {
      this.ctx.input.remove('touch');
      if (this.hud.touch) this.ctx.input.add(new TouchSource(this.ctx.input, this.hud.el));
    }
    this.ctx.input.drivingEnabled = true;
    this.ctx.ui.navEnabled = false;
    this.ctx.audio.setPaused(false);
  }

  fixedUpdate(dt: number): void {
    if (this.paused || this.frozen) return;
    this.session.fixedUpdate(dt, this.ctx.input.drive);
  }

  update(dt: number, alpha: number): void {
    const ctx = this.ctx;
    const s = this.session;
    if (s.intro > 0 && !this.paused) {
      const d = ctx.input.drive;
      if (
        d.throttle > 0 ||
        d.brake > 0 ||
        d.handbrake ||
        ctx.input.pressed('uiConfirm') ||
        ctx.input.pressed('pause') ||
        ctx.input.pressed('reset')
      ) {
        ctx.input.consume('pause');
        ctx.input.consume('reset');
        s.skipIntro();
      }
    }
    if (!this.paused && !this.resultsShown && s.intro <= 0) {
      if (ctx.input.pressed('pause')) {
        ctx.input.consume('pause');
        this.openPause();
        return;
      }
      if (ctx.input.pressed('reset')) s.respawn(true);
      if (ctx.input.pressed('camera')) {
        ctx.save.data.settings.camera = s.camera.cycle();
        ctx.save.save();
      }
    }
    s.update(this.paused ? 0 : dt, alpha);
    this.hud.update(dt);
    if (this.probe?.visible) {
      const ph = s.vehicle.physics;
      this.probe.update(dt, ph.position.x, ph.position.z);
    }
    if (this.debugMap?.visible) {
      const ph = s.vehicle.physics;
      const f = ph.quaternion;
      // Heading of the nose (+Z rotated by the orientation) projected on the ground.
      const fx = 2 * (f.x * f.z + f.w * f.y);
      const fz = 1 - 2 * (f.x * f.x + f.y * f.y);
      this.debugMap.update(ph.position.x, ph.position.z, Math.atan2(fx, fz));
    }
    if (s.phase === 'finished' && !this.resultsShown && s.finishTimer > 2.2) {
      this.resultsShown = true;
      s.summary = finalizeRun(ctx, s);
      ctx.input.drivingEnabled = false;
      ctx.ui.navEnabled = true;
      this.hud.el.classList.add('dim');
      ctx.states.push('results', { playing: this });
    }
  }

  /** Builds loading params for the track after this one (or null at the end). */
  nextMountain(): {
    mountainId: string;
    mode: 'freeDescent' | 'daily';
    time: 'default';
    weather: 'default';
    mountain?: ReturnType<typeof createDailyMountain>;
  } | null {
    const s = this.session;
    if (s.cfg.mode.id === 'daily')
      return {
        mountainId: s.cfg.mountain.id,
        mode: 'daily',
        time: 'default',
        weather: 'default',
        mountain: createDailyMountain(todayKey()),
      };
    const all = this.ctx.registries.mountains.all();
    const i = all.findIndex((t) => t.id === s.cfg.mountain.id);
    const next = all[i + 1];
    return next && isMountainUnlocked(this.ctx, next.id)
      ? { mountainId: next.id, mode: 'freeDescent', time: 'default', weather: 'default' }
      : null;
  }

  exit(): void {
    const ctx = this.ctx;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointerdown', this.onSkipTap);
    window.removeEventListener('keydown', this.onDebugKey);
    this.debugMap?.dispose();
    this.probe?.dispose();
    this.probe = null;
    this.debugMap = null;
    this.offs.forEach((o) => o());
    ctx.input.remove('touch');
    ctx.input.remove('tilt');
    ctx.input.drivingEnabled = false;
    ctx.ui.navEnabled = true;
    ctx.audio.setPaused(false);
    this.hud.dispose();
    this.session.dispose();
    ctx.view = null;
    delete (window as unknown as { __md?: object }).__md;
  }
}
