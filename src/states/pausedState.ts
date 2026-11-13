import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { createPause } from '../ui/screens/pause';
import { createSettings } from '../ui/screens/settings';
import type { PlayingState } from './playingState';

/** Overlay above Playing. The race scene keeps rendering behind it (frozen). */
export class PausedState implements GameState<StateId> {
  readonly id = 'paused' as const;
  readonly transparent = true;
  private playing!: PlayingState;

  constructor(private readonly ctx: GameContext) {}

  enter(params?: unknown): void {
    this.playing = (params as { playing: PlayingState }).playing;
    const ctx = this.ctx;
    ctx.ui.openModal(
      createPause(ctx, {
        resume: () => ctx.states.pop(),
        restart: () => {
          ctx.states.pop();
          this.playing.restart();
        },
        settings: () =>
          ctx.ui.openModal(
            createSettings(
              ctx,
              () => ctx.ui.closeModal(),
              () => undefined,
            ),
          ),
        quit: () => ctx.states.go('mainMenu'),
      }),
    );
  }

  update(): void {
    // Resume with the pause key as well.
    if (this.ctx.input.pressed('pause') && !this.ctx.ui.modalOpen) this.ctx.states.pop();
  }

  exit(): void {
    while (this.ctx.ui.modalOpen) this.ctx.ui.closeModal();
  }
}
