import { clamp } from '../math/util';
import type { InputSource, RawInput } from './inputManager';

type OrientationEventCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/** Steering by tilting the phone (landscape). Angle is relative to the pose when enabled. */
export class TiltSource implements InputSource {
  readonly id = 'tilt';
  private angle = 0;
  private zero: number | null = null;
  sensitivity = 1;
  private enabled = false;

  /** iOS requires a user gesture + permission prompt. Returns false when denied. */
  static async requestPermission(): Promise<boolean> {
    const ctor = (window as unknown as { DeviceOrientationEvent?: OrientationEventCtor })
      .DeviceOrientationEvent;
    if (!ctor) return false;
    if (typeof ctor.requestPermission === 'function') {
      try {
        return (await ctor.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.zero = null;
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  recenter(): void {
    this.zero = null;
  }

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    // In landscape the steering axis is beta; sign depends on which side is up.
    const orientation = (screen.orientation?.angle ??
      (window as unknown as { orientation?: number }).orientation ??
      90) as number;
    const raw =
      orientation === 90
        ? (e.beta ?? 0)
        : orientation === -90 || orientation === 270
          ? -(e.beta ?? 0)
          : (e.gamma ?? 0);
    if (this.zero === null) this.zero = raw;
    this.angle = raw - this.zero;
  };

  update(_dt: number, out: RawInput): void {
    if (!this.enabled) return;
    const deg = this.angle;
    const range = 28 / this.sensitivity;
    const v = clamp(deg / range, -1, 1);
    out.steer += Math.abs(v) < 0.04 ? 0 : v;
  }

  dispose(): void {
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.enabled = false;
  }
}
