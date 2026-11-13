import type { GameContext } from '../core/context';
import { MenuBackdrop } from '../game/menuBackdrop';

/**
 * Lazily creates and caches the menu backdrop so menu screens share it, and frees it when a
 * race starts. Owned by main.ts and handed to the menu states.
 */
export class BackdropHost {
  private backdrop: MenuBackdrop | null = null;

  constructor(private readonly ctx: GameContext) {}

  get(): MenuBackdrop {
    if (!this.backdrop) this.backdrop = new MenuBackdrop(this.ctx);
    return this.backdrop;
  }

  get exists(): boolean {
    return this.backdrop !== null;
  }

  release(): void {
    this.backdrop?.dispose();
    this.backdrop = null;
  }
}
