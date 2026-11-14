import { clamp } from '../math/util';
import {
  ACTIONS,
  DEFAULT_KEY_BINDINGS,
  createDriveState,
  type ActionId,
  type DriveState,
} from './actions';
import type { Settings } from '../core/settings';

/** Raw per-frame contribution of an input device. */
export interface RawInput {
  /** Analog axes (0..1 for throttle/brake, -1..1 for steer). Combined with max/sum. */
  throttle: number;
  brake: number;
  steer: number;
  /** True for digital steering sources that should be smoothed. */
  steerDigital: boolean;
  held: Set<ActionId>;
  /** Free-look rotation this frame (radians, + = right / up) and whether a look is held. */
  lookX: number;
  lookY: number;
  looking: boolean;
}

/** Free-look state for the camera, merged from mouse/touch drags and the right stick. */
export interface LookState {
  dx: number;
  dy: number;
  active: boolean;
}

export interface InputSource {
  readonly id: string;
  update(dt: number, out: RawInput): void;
  dispose(): void;
}

/**
 * Merges every device into one DriveState + action edges. Devices register as sources; game
 * code only reads `drive`, `pressed(action)` and `held(action)`.
 */
export class InputManager {
  readonly drive: DriveState = createDriveState();
  readonly look: LookState = { dx: 0, dy: 0, active: false };
  private readonly sources: InputSource[] = [];
  private readonly raw: RawInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    steerDigital: false,
    held: new Set(),
    lookX: 0,
    lookY: 0,
    looking: false,
  };
  private prevHeld = new Set<ActionId>();
  private currHeld = new Set<ActionId>();
  private readonly pressedSet = new Set<ActionId>();
  private smoothSteer = 0;
  /** Set by settings. */
  autoAccelerate = false;
  steerSensitivity = 1;
  /** When false, driving axes are zeroed (menus). Edges keep working. */
  drivingEnabled = true;
  /** Last device that produced input: used to show the right prompts. */
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  bindings: Record<ActionId, string[]> = { ...DEFAULT_KEY_BINDINGS };

  add(source: InputSource): void {
    this.sources.push(source);
  }

  remove(id: string): void {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.sources[i].dispose();
      this.sources.splice(i, 1);
    }
  }

  has(id: string): boolean {
    return this.sources.some((s) => s.id === id);
  }

  applySettings(s: Settings): void {
    this.autoAccelerate = s.autoAccelerate;
    this.steerSensitivity = s.steerSensitivity;
    this.bindings = { ...DEFAULT_KEY_BINDINGS };
    for (const a of ACTIONS) {
      const custom = s.bindings[a];
      if (custom && custom.length) this.bindings[a] = custom;
    }
  }

  /** Call once per rendered frame before game logic. */
  update(dt: number): void {
    const raw = this.raw;
    raw.throttle = 0;
    raw.brake = 0;
    raw.steer = 0;
    raw.steerDigital = false;
    raw.held.clear();
    raw.lookX = raw.lookY = 0;
    raw.looking = false;
    for (const s of this.sources) s.update(dt, raw);
    this.look.dx = raw.lookX;
    this.look.dy = raw.lookY;
    this.look.active = raw.looking;

    const swap = this.prevHeld;
    this.prevHeld = this.currHeld;
    this.currHeld = swap;
    this.currHeld.clear();
    raw.held.forEach((a) => this.currHeld.add(a));
    this.pressedSet.clear();
    this.currHeld.forEach((a) => {
      if (!this.prevHeld.has(a)) this.pressedSet.add(a);
    });

    const d = this.drive;
    // Digital steering ramps in (and snaps back faster) for controllable keyboard driving.
    const target = clamp(raw.steer * this.steerSensitivity, -1, 1);
    if (raw.steerDigital) {
      const rate =
        Math.sign(target) !== Math.sign(this.smoothSteer) ||
        Math.abs(target) < Math.abs(this.smoothSteer)
          ? 9
          : 4.5;
      const delta = target - this.smoothSteer;
      this.smoothSteer += clamp(delta, -rate * dt, rate * dt);
    } else {
      this.smoothSteer = target;
    }
    if (!this.drivingEnabled) {
      d.throttle = d.brake = d.steer = 0;
      d.handbrake = d.nitro = false;
      this.smoothSteer = 0;
      return;
    }
    d.steer = clamp(this.smoothSteer, -1, 1);
    d.brake = clamp(raw.brake, 0, 1);
    d.throttle = clamp(raw.throttle, 0, 1);
    if (this.autoAccelerate && d.brake < 0.1) d.throttle = Math.max(d.throttle, 1);
    d.handbrake = this.currHeld.has('handbrake');
    d.nitro = this.currHeld.has('nitro');
  }

  pressed(a: ActionId): boolean {
    return this.pressedSet.has(a);
  }

  held(a: ActionId): boolean {
    return this.currHeld.has(a);
  }

  /** Consumes a press so other listeners in the same frame do not react to it. */
  consume(a: ActionId): boolean {
    return this.pressedSet.delete(a);
  }

  dispose(): void {
    this.sources.forEach((s) => s.dispose());
    this.sources.length = 0;
  }
}
