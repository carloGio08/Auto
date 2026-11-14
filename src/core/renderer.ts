import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type Camera,
  type Scene,
} from 'three';
import { config, type QualityPreset, type QualityPresetId } from '../config';
import type { QualitySetting } from './settings';
import type { DeviceInfo } from './device';

const ORDER: QualityPresetId[] = ['low', 'medium', 'high'];

/**
 * Wraps WebGLRenderer: sizing, pixel-ratio cap, quality presets, dynamic resolution scaling
 * and automatic quality degradation when the frame budget is exceeded.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  setting: QualitySetting;
  preset: QualityPreset;
  presetId: QualityPresetId;
  /** Dynamic resolution scale (minScale..1, never below 0.85: the image stays sharp). */
  scale = 1;
  private timer = 0;
  private slowStreak = 0;
  private fastStreak = 0;
  private readonly listeners = new Set<(id: QualityPresetId) => void>();
  private readonly degradeListeners = new Set<(level: number) => void>();
  /**
   * Fine degradation inside a preset before dropping to the next one (see
   * World.setDegrade): 1 no wind, 2 thinner grass and flowers, 3 shorter far forest,
   * 4 smaller shadow map (never below 1024). Dynamic resolution never goes below 0.85.
   */
  degrade = 0;
  static readonly MAX_DEGRADE = 4;
  private readonly autoCeiling: QualityPresetId;
  width = 1;
  height = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    setting: QualitySetting,
    device: DeviceInfo,
    /** Level recorded by a previous session's automatic quality (start there). */
    lastAuto: QualityPresetId | null = null,
  ) {
    this.setting = setting;
    this.autoCeiling = device.lowEnd ? 'low' : device.mobile ? 'medium' : 'high';
    const start =
      lastAuto && ORDER.indexOf(lastAuto) < ORDER.indexOf(this.autoCeiling)
        ? lastAuto
        : this.autoCeiling;
    this.presetId = setting === 'auto' ? start : setting;
    this.preset = config.graphics.presets[this.presetId];
    this.gl = new WebGLRenderer({
      canvas,
      // MSAA on every preset: a crisp, unaliased image is never traded for speed (presets
      // degrade density and distance instead).
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.resize();
  }

  onQualityChange(fn: (id: QualityPresetId) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onDegrade(fn: (level: number) => void): () => void {
    this.degradeListeners.add(fn);
    return () => this.degradeListeners.delete(fn);
  }

  private setDegrade(level: number): void {
    if (level === this.degrade) return;
    this.degrade = level;
    this.degradeListeners.forEach((l) => l(level));
  }

  applySetting(setting: QualitySetting): void {
    this.setDegrade(0);
    this.setting = setting;
    this.setPreset(setting === 'auto' ? this.autoCeiling : setting);
    this.scale = 1;
    this.resize();
  }

  private setPreset(id: QualityPresetId): void {
    if (id === this.presetId) return;
    this.presetId = id;
    this.preset = config.graphics.presets[id];
    this.listeners.forEach((l) => l(id));
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    // Default min(devicePixelRatio, 2); the canvas is drawn at its CSS size (no CSS upscaling).
    const ratio = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap, 2) * this.scale;
    this.gl.setPixelRatio(Math.max(0.85, ratio));
    this.gl.setSize(w, h, false);
  }

  /** Called every frame with the smoothed frame time. Only adapts while `adaptive` is true. */
  adapt(frameMs: number, dt: number, adaptive: boolean): void {
    if (!adaptive || !config.features.dynamicResolution) return;
    this.timer += dt;
    const dr = config.graphics.dynamicResolution;
    if (this.timer < dr.interval) return;
    this.timer = 0;
    if (frameMs > dr.downMs) {
      this.fastStreak = 0;
      if (this.scale > dr.minScale) {
        this.scale = Math.max(dr.minScale, this.scale - 0.1);
        this.resize();
      } else if (this.setting === 'auto' && ++this.slowStreak >= 3) {
        this.slowStreak = 0;
        const idx = ORDER.indexOf(this.presetId);
        if (this.degrade < Renderer.MAX_DEGRADE) this.setDegrade(this.degrade + 1);
        else if (idx > 0) {
          this.scale = 0.85;
          this.setDegrade(0);
          this.setPreset(ORDER[idx - 1]);
        }
      }
    } else if (frameMs < dr.upMs) {
      this.slowStreak = 0;
      if (this.scale < 1) {
        this.scale = Math.min(1, this.scale + 0.05);
        this.resize();
      } else if (this.setting === 'auto' && ++this.fastStreak >= 8) {
        this.fastStreak = 0;
        const idx = ORDER.indexOf(this.presetId);
        if (this.degrade > 0) this.setDegrade(this.degrade - 1);
        else if (idx < ORDER.indexOf(this.autoCeiling)) this.setPreset(ORDER[idx + 1]);
      }
    }
  }

  render(scene: Scene, camera: Camera): void {
    this.gl.render(scene, camera);
  }

  dispose(): void {
    this.gl.dispose();
  }
}
