import type { InputManager, InputSource, RawInput } from './inputManager';

const DEADZONE = 0.15;
const dz = (v: number): number =>
  Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);

/**
 * Standard-mapping gamepads: RT throttle, LT brake, left stick steer, A nitro, X/RB handbrake,
 * Y camera, View reset, Menu pause, D-pad + A/B for menus.
 */
export class GamepadSource implements InputSource {
  readonly id = 'gamepad';

  constructor(private readonly manager: InputManager) {}

  update(_dt: number, out: RawInput): void {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i: number): number => pad.buttons[i]?.value ?? 0;
      const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
      const sx = dz(pad.axes[0] ?? 0);
      const sy = dz(pad.axes[1] ?? 0);
      const throttle = b(7);
      const brake = b(6);
      let used = false;
      if (throttle > 0.05) {
        out.throttle = Math.max(out.throttle, throttle);
        out.held.add('throttle');
        used = true;
      }
      if (brake > 0.05) {
        out.brake = Math.max(out.brake, brake);
        out.held.add('brake');
        used = true;
      }
      if (sx !== 0) {
        out.steer += sx;
        used = true;
      }
      const map: [number, Parameters<RawInput['held']['add']>[0]][] = [
        [0, 'nitro'],
        [2, 'handbrake'],
        [5, 'handbrake'],
        [3, 'camera'],
        [8, 'reset'],
        [9, 'pause'],
        [12, 'uiUp'],
        [13, 'uiDown'],
        [14, 'uiLeft'],
        [15, 'uiRight'],
        [0, 'uiConfirm'],
        [1, 'uiBack'],
      ];
      for (const [i, action] of map) {
        if (pressed(i)) {
          out.held.add(action);
          used = true;
        }
      }
      // Left stick also navigates menus.
      if (sy < -0.6) out.held.add('uiUp');
      if (sy > 0.6) out.held.add('uiDown');
      if (sx < -0.6) out.held.add('uiLeft');
      if (sx > 0.6) out.held.add('uiRight');
      if (used) this.manager.lastDevice = 'gamepad';
    }
  }

  dispose(): void {}
}
