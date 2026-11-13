import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { vibrate } from '../core/device';
import type { RunSession } from '../game/session';
import { finalizeRun, isTrackUnlocked } from '../game/progression';
import { Autopilot } from '../vehicle/autopilot';
import { TouchSource } from '../input/touch';
import { Hud } from '../ui/hud';
import { createDailyTrack, todayKey } from '../data/tracks';

/** Drives a RunSession: input, simulation, HUD, pause and the transition to results. */
export class PlayingState implements GameState<StateId> {
  readonly id = 'playing' as const;
  session!: RunSession;
  private hud!: Hud;
  private resultsShown = false;
  private paused = false;
  private readonly offs: (() => void)[] = [];
  private readonly onVisibility = (): void => {
    if (document.hidden && !this.paused && this.session.phase !== 'finished') this.openPause();
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
    this.session.start();
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
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    // Debug hook for automated tests (dev builds or ?e2e only).
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
      (window as unknown as { __md?: object }).__md = {
        session: this.session,
        finish: () => (this.session.progressS = this.session.course.finishS + 1),
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
    if (this.paused) return;
    this.session.fixedUpdate(dt, this.ctx.input.drive);
  }

  update(dt: number, alpha: number): void {
    const ctx = this.ctx;
    const s = this.session;
    if (!this.paused && !this.resultsShown) {
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
    if (
      (s.phase === 'finished' || s.phase === 'timeout') &&
      !this.resultsShown &&
      s.finishTimer > 2.2
    ) {
      this.resultsShown = true;
      s.summary = finalizeRun(ctx, s);
      ctx.input.drivingEnabled = false;
      ctx.ui.navEnabled = true;
      this.hud.el.classList.add('dim');
      ctx.states.push('results', { playing: this });
    }
  }

  /** Builds loading params for the track after this one (or null at the end). */
  nextTrack(): {
    trackId: string;
    mode: 'timeAttack' | 'daily';
    time: 'default';
    weather: 'default';
    track?: ReturnType<typeof createDailyTrack>;
  } | null {
    const s = this.session;
    if (s.cfg.mode.id === 'daily')
      return {
        trackId: s.cfg.track.id,
        mode: 'daily',
        time: 'default',
        weather: 'default',
        track: createDailyTrack(todayKey()),
      };
    const all = this.ctx.registries.tracks.all();
    const i = all.findIndex((t) => t.id === s.cfg.track.id);
    const next = all[i + 1];
    return next && isTrackUnlocked(this.ctx, next.id)
      ? { trackId: next.id, mode: 'timeAttack', time: 'default', weather: 'default' }
      : null;
  }

  exit(): void {
    const ctx = this.ctx;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
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
