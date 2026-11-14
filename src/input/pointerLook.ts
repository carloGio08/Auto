import type { InputManager, InputSource, RawInput } from './inputManager';

/** Radians of camera rotation per CSS pixel of drag. */
const MOUSE_SENS = 0.006;
const TOUCH_SENS = 0.008;

/**
 * Free look by dragging on the 3D view: any mouse button, or one finger anywhere that is not
 * an on-screen control (those sit in the HUD layer above the canvas and never reach it).
 */
export class PointerLookSource implements InputSource {
  readonly id = 'pointerLook';
  private pointer = -1;
  private lastX = 0;
  private lastY = 0;
  private dx = 0;
  private dy = 0;
  private readonly fingers = new Set<number>();

  constructor(
    private readonly manager: InputManager,
    private readonly target: HTMLElement,
  ) {
    target.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    target.addEventListener('contextmenu', this.prevent);
  }

  private readonly prevent = (e: Event): void => e.preventDefault();

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') {
      this.fingers.add(e.pointerId);
      // A second finger on the view cancels the look (avoid fighting pinch gestures).
      if (this.fingers.size > 1) {
        this.pointer = -1;
        return;
      }
      this.manager.lastDevice = 'touch';
    }
    this.pointer = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    const k = e.pointerType === 'mouse' ? MOUSE_SENS : TOUCH_SENS;
    this.dx += (e.clientX - this.lastX) * k;
    this.dy -= (e.clientY - this.lastY) * k;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.fingers.delete(e.pointerId);
    if (e.pointerId === this.pointer) this.pointer = -1;
  };

  update(_dt: number, out: RawInput): void {
    if (this.pointer >= 0 || this.dx !== 0 || this.dy !== 0) {
      out.lookX += this.dx;
      out.lookY += this.dy;
      out.looking = out.looking || this.pointer >= 0;
    }
    this.dx = this.dy = 0;
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.target.removeEventListener('contextmenu', this.prevent);
  }
}
