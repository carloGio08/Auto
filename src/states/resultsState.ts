import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { createResults } from '../ui/screens/results';
import type { PlayingState } from './playingState';

/** Results overlay above the finished race. */
export class ResultsState implements GameState<StateId> {
  readonly id = 'results' as const;
  readonly transparent = true;

  constructor(private readonly ctx: GameContext) {}

  enter(params?: unknown): void {
    const playing = (params as { playing: PlayingState }).playing;
    const ctx = this.ctx;
    const s = playing.session;
    const next = playing.nextTrack();
    ctx.ui.openModal(
      createResults(ctx, s.summary!, s.cfg.mode, {
        retry: () => {
          ctx.states.pop();
          playing.restart();
        },
        next: next && s.cfg.mode.id !== 'daily' ? () => ctx.states.go('loading', next) : null,
        menu: () => ctx.states.go('mainMenu'),
      }),
    );
  }

  update(): void {}

  exit(): void {
    while (this.ctx.ui.modalOpen) this.ctx.ui.closeModal();
  }
}
