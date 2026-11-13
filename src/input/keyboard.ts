import type { ActionId } from './actions';
import { ACTIONS } from './actions';
import type { InputManager, InputSource, RawInput } from './inputManager';

/** Keyboard device: maps KeyboardEvent.code to actions through the manager's bindings. */
export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private readonly down = new Set<string>();
  /** When set, the next key press is delivered here instead of to the game (rebinding). */
  captureNext: ((code: string) => void) | null = null;

  constructor(private readonly manager: InputManager) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    if (this.captureNext) {
      e.preventDefault();
      const cb = this.captureNext;
      this.captureNext = null;
      cb(e.code);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT') &&
      e.code !== 'Escape'
    )
      return;
    this.down.add(e.code);
    this.manager.lastDevice = 'keyboard';
    // Prevent page scrolling with arrows/space while playing.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
      e.preventDefault();
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };

  private isHeld(action: ActionId): boolean {
    for (const code of this.manager.bindings[action]) if (this.down.has(code)) return true;
    return false;
  }

  update(_dt: number, out: RawInput): void {
    if (this.down.size === 0) return;
    for (const a of ACTIONS) if (this.isHeld(a)) out.held.add(a);
    if (this.isHeld('throttle')) out.throttle = Math.max(out.throttle, 1);
    if (this.isHeld('brake')) out.brake = Math.max(out.brake, 1);
    const steer = (this.isHeld('steerRight') ? 1 : 0) - (this.isHeld('steerLeft') ? 1 : 0);
    if (steer !== 0) {
      out.steer += steer;
      out.steerDigital = true;
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
