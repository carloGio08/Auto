import type { PerspectiveCamera, Scene } from 'three';
import type { config as Config } from '../config';
import type { ContentRegistries } from '../data/registry';
import type { InputManager } from '../input/inputManager';
import type { KeyboardSource } from '../input/keyboard';
import type { TiltSource } from '../input/tilt';
import type { AudioEngine } from '../audio/audioEngine';
import type { UIManager } from '../ui/uiManager';
import type { EventBus } from './eventBus';
import type { GameEvents } from './events';
import type { I18n } from './i18n';
import type { GameLoop } from './loop';
import type { Renderer } from './renderer';
import type { SaveManager } from './save';
import type { StateMachine } from './stateMachine';
import type { DeviceInfo } from './device';
import type { TerrainService } from '../terrain/terrainService';

export type StateId =
  'boot' | 'mainMenu' | 'garage' | 'trackSelect' | 'loading' | 'playing' | 'paused' | 'results';

/** What the renderer draws this frame; owned by whichever state is active. */
export interface View {
  scene: Scene;
  camera: PerspectiveCamera;
}

/**
 * The single object that gives modules access to app-wide services. Passed explicitly
 * (no globals). A run-specific RunSession extends this with world/vehicle/systems.
 */
export interface GameContext {
  readonly config: typeof Config;
  readonly registries: ContentRegistries;
  readonly renderer: Renderer;
  view: View | null;
  readonly input: InputManager;
  readonly keyboard: KeyboardSource;
  readonly tilt: TiltSource;
  readonly audio: AudioEngine;
  readonly save: SaveManager;
  readonly events: EventBus<GameEvents>;
  readonly i18n: I18n;
  readonly ui: UIManager;
  readonly states: StateMachine<StateId>;
  readonly loop: GameLoop;
  readonly device: DeviceInfo;
  /** Terrain generation worker and patch builder (app lifetime, caches recent mountains). */
  readonly terrain: TerrainService;
  /** Applies settings from the save file to every service. */
  applySettings(): void;
}
