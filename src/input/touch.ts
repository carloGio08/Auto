import type { ActionId } from './actions';
import type { InputManager, InputSource, RawInput } from './inputManager';

/**
 * On-screen touch controls. The HUD creates buttons with `data-touch="<action>"`; this source
 * tracks every active pointer (multitouch) and which button it is over.
 *
 * Presses start on the buttons, but releases are listened for on the whole window: the HUD
 * layer lets touches through everywhere except on the buttons, so a finger that slides off a
 * button and lifts over the game would otherwise never report its release and the action
 * would stay held. Safety nets clear stale pointers when the last finger lifts (touchend with
 * no touches left), when a new primary pointer starts, and when the page loses focus or is
 * hidden.
 */
export class TouchSource implements InputSource {
  readonly id = 'touch';
  private readonly pointers = new Map<number, ActionId>();
  /** Buttons touched since the last poll (very short taps on slow frames). */
  private readonly tapped = new Set<ActionId>();
  /** Steering from tilt or analog sources is added by TiltSource; this handles buttons only. */

  constructor(
    private readonly manager: InputManager,
    private readonly root: HTMLElement,
  ) {
    root.addEventListener('pointerdown', this.onDown, { passive: false });
    root.addEventListener('contextmenu', this.prevent);
    window.addEventListener('pointermove', this.onMove, { passive: false, capture: true });
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
    window.addEventListener('touchend', this.onTouchEnd, true);
    window.addEventListener('touchcancel', this.onTouchEnd, true);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private readonly prevent = (e: Event): void => e.preventDefault();

  private actionAt(x: number, y: number): ActionId | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const btn = el?.closest<HTMLElement>('[data-touch]');
    return btn && this.root.contains(btn) ? (btn.dataset.touch as ActionId) : null;
  }

  private setActive(): void {
    const active = new Set(this.pointers.values());
    this.root.querySelectorAll<HTMLElement>('[data-touch]').forEach((el) => {
      el.classList.toggle('active', active.has(el.dataset.touch as ActionId));
    });
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    const a = this.actionAt(e.clientX, e.clientY);
    if (!a) return;
    e.preventDefault();
    this.manager.lastDevice = 'touch';
    // A primary pointer means no other finger is down: anything still recorded is stale.
    if (e.isPrimary) this.pointers.clear();
    this.pointers.set(e.pointerId, a);
    this.tapped.add(a);
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    this.setActive();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const a = this.actionAt(e.clientX, e.clientY);
    // Sliding a finger between steering buttons switches direction; leaving all buttons keeps the last.
    if (a && a !== this.pointers.get(e.pointerId)) {
      this.pointers.set(e.pointerId, a);
      this.setActive();
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.pointers.delete(e.pointerId)) this.setActive();
  };

  /** Some mobile browsers drop pointer events: no touches left means nothing is held. */
  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0) this.releaseAll();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  /** Releases every held button (focus lost, page hidden, all fingers lifted). */
  readonly releaseAll = (): void => {
    if (this.pointers.size === 0) return;
    this.pointers.clear();
    this.setActive();
  };

  /** Actions currently held by a finger (tests, debugging). */
  get held(): ActionId[] {
    return [...this.pointers.values()];
  }

  update(_dt: number, out: RawInput): void {
    for (const a of this.tapped) if (![...this.pointers.values()].includes(a)) out.held.add(a);
    this.tapped.clear();
    for (const a of this.pointers.values()) {
      out.held.add(a);
      if (a === 'throttle') out.throttle = Math.max(out.throttle, 1);
      if (a === 'brake') out.brake = Math.max(out.brake, 1);
      if (a === 'steerLeft') {
        out.steer -= 1;
        out.steerDigital = true;
      }
      if (a === 'steerRight') {
        out.steer += 1;
        out.steerDigital = true;
      }
    }
  }

  dispose(): void {
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('contextmenu', this.prevent);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onUp, true);
    window.removeEventListener('touchend', this.onTouchEnd, true);
    window.removeEventListener('touchcancel', this.onTouchEnd, true);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.pointers.clear();
  }
}
