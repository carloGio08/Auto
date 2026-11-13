import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { createTrackSelect } from '../ui/screens/trackSelect';
import type { BackdropHost } from './backdropHost';
import type { LoadingParams } from './loadingState';

export class TrackSelectState implements GameState<StateId> {
  readonly id = 'trackSelect' as const;

  constructor(
    private readonly ctx: GameContext,
    private readonly backdrop: BackdropHost,
  ) {}

  enter(): void {
    const ctx = this.ctx;
    ctx.view = this.backdrop.get().view;
    ctx.ui.setScreen(
      createTrackSelect(
        ctx,
        () => ctx.states.go('mainMenu'),
        (choice) => {
          const save = ctx.save.data;
          save.lastTrack = choice.trackId;
          save.lastTime = choice.time;
          save.lastWeather = choice.weather;
          ctx.save.save();
          const params: LoadingParams = { ...choice };
          ctx.states.go('loading', params);
        },
      ),
    );
  }

  update(dt: number): void {
    this.backdrop.get().update(dt);
  }

  exit(): void {
    this.ctx.ui.setScreen(null);
  }
}
