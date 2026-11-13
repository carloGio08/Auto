import { clamp } from '../math/util';
import { MusicPlayer } from './music';
import { createNoiseBuffer, Sfx } from './sfx';
import { EngineSound } from './engine';

/**
 * Root of the procedural audio graph:
 *   sources → sfxBus / musicBus → master → destination
 * The AudioContext is created lazily and resumed on the first user gesture.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  noise!: AudioBuffer;
  sfx!: Sfx;
  music!: MusicPlayer;
  private volumes = { master: 0.8, music: 0.45, sfx: 0.85 };
  private muted = false;
  private musicEnabled = true;
  private readonly engines = new Set<EngineSound>();

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Call from a user gesture handler. Safe to call many times. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.noise = createNoiseBuffer(ctx);
      this.sfx = new Sfx(ctx, this.sfxBus, this.noise);
      this.music = new MusicPlayer(ctx, this.musicBus);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(
    master: number,
    music: number,
    sfx: number,
    muted: boolean,
    musicEnabled = true,
  ): void {
    this.volumes = {
      master: clamp(master, 0, 1),
      music: clamp(music, 0, 1),
      sfx: clamp(sfx, 0, 1),
    };
    this.muted = muted;
    this.musicEnabled = musicEnabled;
    this.applyVolumes();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicEnabled ? this.volumes.music * 0.6 : 0, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  /** Creates a looping engine/wind/tyre voice for a car. */
  createEngine(character: number): EngineSound | null {
    if (!this.ctx) return null;
    const e = new EngineSound(this.ctx, this.sfxBus, this.noise, character);
    this.engines.add(e);
    return e;
  }

  releaseEngine(e: EngineSound | null): void {
    if (!e) return;
    e.dispose();
    this.engines.delete(e);
  }

  /** Pauses continuous sounds (game paused / tab hidden). */
  setPaused(paused: boolean): void {
    this.engines.forEach((e) => e.setPaused(paused));
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
