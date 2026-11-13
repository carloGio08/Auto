import type { ActionId } from './actions';
import type { InputManager, InputSource, RawInput } from './inputManager';

/**
 * On-screen touch controls. The HUD creates buttons with `data-touch="<action>"`; this source
 * tracks every active pointer (multitouch) and which button it is over.
 */
export class TouchSource implements InputSource {
  readonly id = 'touch';
  private readonly pointers = new Map<number, ActionId>();
  /** Steering from tilt or analog sources is added by TiltSource; this handles buttons only. */

  constructor(
    private readonly manager: InputManager,
    private readonly root: HTMLElement,
  ) {
    root.addEventListener('pointerdown', this.onDown, { passive: false });
    root.addEventListener('pointermove', this.onMove, { passive: false });
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('lostpointercapture', this.onUp);
    root.addEventListener('contextmenu', this.prevent);
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
    this.pointers.set(e.pointerId, a);
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

  update(_dt: number, out: RawInput): void {
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
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onUp);
    this.root.removeEventListener('pointercancel', this.onUp);
    this.root.removeEventListener('lostpointercapture', this.onUp);
    this.root.removeEventListener('contextmenu', this.prevent);
    this.pointers.clear();
  }
}
