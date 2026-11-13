/** Every logical input action. Devices are mapped onto these. */
export const ACTIONS = [
  'throttle',
  'brake',
  'steerLeft',
  'steerRight',
  'handbrake',
  'nitro',
  'reset',
  'camera',
  'pause',
  'uiUp',
  'uiDown',
  'uiLeft',
  'uiRight',
  'uiConfirm',
  'uiBack',
] as const;

export type ActionId = (typeof ACTIONS)[number];

/** Actions that can be rebound in the settings screen. */
export const REBINDABLE: ActionId[] = [
  'throttle',
  'brake',
  'steerLeft',
  'steerRight',
  'handbrake',
  'nitro',
  'reset',
  'camera',
  'pause',
];

export const DEFAULT_KEY_BINDINGS: Record<ActionId, string[]> = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight'],
  reset: ['KeyR'],
  camera: ['KeyC'],
  pause: ['KeyP', 'Escape'],
  uiUp: ['ArrowUp', 'KeyW'],
  uiDown: ['ArrowDown', 'KeyS'],
  uiLeft: ['ArrowLeft', 'KeyA'],
  uiRight: ['ArrowRight', 'KeyD'],
  uiConfirm: ['Enter', 'Space'],
  uiBack: ['Escape', 'Backspace'],
};

/** Continuous driving state produced by the input manager each frame. */
export interface DriveState {
  throttle: number;
  brake: number;
  /** -1 = full left, +1 = full right. */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
}

export const createDriveState = (): DriveState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  nitro: false,
});
