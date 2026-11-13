import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { h } from '../ui/dom';
import type { BackdropHost } from './backdropHost';

/** Shows a splash while the menu world is generated, then opens the main menu. */
export class BootState implements GameState<StateId> {
  readonly id = 'boot' as const;
  private frames = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly backdrop: BackdropHost,
  ) {}

  enter(): void {
    this.ctx.ui.setScreen({
      el: h(
        'div',
        { class: 'screen splash' },
        h('div', { class: 'splash-title' }, this.ctx.i18n.t('app.title')),
        h('div', { class: 'spinner' }),
      ),
    });
  }

  update(): void {
    // Wait two frames so the splash is painted before the (blocking) world generation.
    if (++this.frames === 3) {
      this.backdrop.get();
      document.getElementById('boot-splash')?.remove();
      this.ctx.states.go('mainMenu');
    }
  }

  exit(): void {}
}
