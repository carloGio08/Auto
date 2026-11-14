import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { h } from '../ui/dom';
import type { BackdropHost } from './backdropHost';
import type { TerrainJob } from '../terrain/terrainService';
import { benchmark } from '../core/benchmark';
import { config } from '../config';

/**
 * Shows a splash while the menu mountain is generated in the terrain worker, then builds the
 * menu backdrop and opens the main menu.
 */
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

  private job: TerrainJob | null = null;

  update(): void {
    // Wait two frames so the splash is painted, then generate off the main thread.
    if (++this.frames < 3) return;
    this.job ??= this.ctx.terrain.prepare(this.ctx.registries.mountains.all()[0]);
    if (this.job.done) {
      this.frames = -1e9;
      if (benchmark.active) {
        document.getElementById('boot-splash')?.remove();
        if (benchmark.quality) this.ctx.renderer.applySetting(benchmark.quality);
        const b = config.benchmark;
        this.ctx.states.go('loading', {
          mountainId: this.ctx.registries.mountains.all()[0].id,
          mode: 'freeDescent',
          time: b.time,
          weather: b.weather,
        });
        return;
      }
      this.backdrop.get();
      document.getElementById('boot-splash')?.remove();
      this.ctx.states.go('mainMenu');
    }
  }

  exit(): void {}
}
