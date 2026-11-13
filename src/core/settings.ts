import type { ActionId } from '../input/actions';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type LanguageSetting = 'auto' | 'en' | 'it';
export type TouchMode = 'buttons' | 'tilt';
export type CameraMode = 'chase' | 'hood' | 'high';

export interface Settings {
  quality: QualitySetting;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  language: LanguageSetting;
  touchMode: TouchMode;
  tiltSensitivity: number;
  steerSensitivity: number;
  autoAccelerate: boolean;
  haptics: boolean;
  showFps: boolean;
  camera: CameraMode;
  /** Keyboard bindings: action → list of KeyboardEvent.code. Missing actions use defaults. */
  bindings: Partial<Record<ActionId, string[]>>;
}

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    masterVolume: 0.8,
    musicVolume: 0.45,
    sfxVolume: 0.85,
    muted: false,
    language: 'auto',
    touchMode: 'buttons',
    tiltSensitivity: 1,
    steerSensitivity: 1,
    autoAccelerate: false,
    haptics: true,
    showFps: false,
    camera: 'chase',
    bindings: {},
  };
}
