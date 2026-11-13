import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import type { ModeId, TimeOfDayId, TrackDef, WeatherId } from '../data/types';
import { RunSession } from '../game/session';
import type { BuildStep } from '../world/world';
import { createLoading, type LoadingScreen } from '../ui/screens/loading';
import type { BackdropHost } from './backdropHost';

export interface LoadingParams {
  trackId: string;
  mode: ModeId;
  time: TimeOfDayId | 'default';
  weather: WeatherId | 'default';
  /** Procedural track (daily challenge) not in the registry. */
  track?: TrackDef;
}

/** Builds the run incrementally (a few ms per frame) while showing progress and a tip. */
export class LoadingState implements GameState<StateId> {
  readonly id = 'loading' as const;
  private gen: Generator<BuildStep, RunSession> | null = null;
  private screen!: LoadingScreen;
  private done = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly backdrop: BackdropHost,
  ) {}

  enter(params?: unknown): void {
    const ctx = this.ctx;
    const p = params as LoadingParams;
    const track = p.track ?? ctx.registries.tracks.get(p.trackId);
    const mode = ctx.registries.modes.get(p.mode);
    // Free the menu world before building the race world.
    ctx.view = null;
    this.backdrop.release();
    this.screen = createLoading(ctx, ctx.i18n.tk(track.nameKey));
    ctx.ui.setScreen(this.screen);
    this.gen = RunSession.create(ctx, {
      track,
      mode,
      carId: ctx.save.data.selectedCar,
      time: p.time === 'default' ? track.defaultTime : p.time,
      weather: p.weather === 'default' ? track.defaultWeather : p.weather,
    });
  }

  update(): void {
    if (!this.gen || this.done) return;
    const start = performance.now();
    while (performance.now() - start < 30) {
      const r = this.gen.next();
      if (r.done) {
        this.done = true;
        this.screen.set(1, 'loading.ready');
        this.ctx.states.go('playing', { session: r.value });
        return;
      }
      this.screen.set(r.value.progress, r.value.stage);
    }
  }

  exit(): void {
    this.ctx.ui.setScreen(null);
  }
}
