import { clamp } from '../math/util';
import { config } from '../config';

/**
 * Continuous car sounds: engine (two detuned oscillators through a waveshaper and a
 * load-dependent low-pass), wind, tyre/gravel noise and nitro hiss.
 */
export class EngineSound {
  private readonly oscA: OscillatorNode;
  private readonly oscB: OscillatorNode;
  private readonly engineFilter: BiquadFilterNode;
  private readonly engineGain: GainNode;
  private readonly windGain: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly tyreGain: GainNode;
  private readonly tyreFilter: BiquadFilterNode;
  private readonly nitroGain: GainNode;
  private readonly out: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    /** 0 = smooth small engine, 1 = big rough V8. */
    private readonly character: number,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.3);

    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * (2 + character * 2));
    }
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.12;
    const mixA = ctx.createGain();
    mixA.gain.value = 0.5;
    const mixB = ctx.createGain();
    mixB.gain.value = 0.25 + character * 0.25;
    this.oscA.connect(mixA).connect(shaper);
    this.oscB.connect(mixB).connect(shaper);
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.out);

    const noiseSrc = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.loopStart = Math.random();
      this.sources.push(s);
      return s;
    };
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noiseSrc().connect(this.windFilter).connect(this.windGain).connect(this.out);

    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.Q.value = 1.2;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    noiseSrc().connect(this.tyreFilter).connect(this.tyreGain).connect(this.out);

    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = 'highpass';
    nitroFilter.frequency.value = 2500;
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    noiseSrc().connect(nitroFilter).connect(this.nitroGain).connect(this.out);

    this.sources.push(this.oscA, this.oscB);
    this.sources.forEach((s) => s.start());
  }

  /**
   * @param rpm engine rpm
   * @param load 0..1 throttle load
   * @param speed m/s
   * @param skid 0..1 tyre slide amount
   * @param roughness 0..1 surface roughness (gravel crunch)
   * @param rolling 0..1 how much the wheels are on the ground
   */
  update(
    rpm: number,
    load: number,
    speed: number,
    skid: number,
    roughness: number,
    rolling: number,
    nitro: boolean,
  ): void {
    const t = this.ctx.currentTime;
    const base = (rpm / 60) * (this.character > 0.6 ? 1 : 2) * 0.5;
    const f = clamp(base, 20, 400);
    this.oscA.frequency.setTargetAtTime(f, t, 0.03);
    this.oscB.frequency.setTargetAtTime(f * 0.5 * 1.005, t, 0.03);
    const rpmN = clamp(
      (rpm - config.audio.engineIdleRpm) / (config.audio.engineMaxRpm - config.audio.engineIdleRpm),
      0,
      1,
    );
    this.engineFilter.frequency.setTargetAtTime(300 + 1800 * load + 1400 * rpmN, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.06 + 0.1 * load + 0.04 * rpmN, t, 0.05);
    const sp = clamp(speed / 50, 0, 1);
    this.windGain.gain.setTargetAtTime(sp * sp * 0.22, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + sp * 1600, t, 0.1);
    const crunch = rolling * clamp(speed / 20, 0, 1) * roughness * 0.12;
    this.tyreGain.gain.setTargetAtTime(crunch + skid * rolling * 0.22, t, 0.04);
    this.tyreFilter.frequency.setTargetAtTime(
      skid > 0.3 ? 900 + roughness * 600 : 2400 + roughness * 1500,
      t,
      0.05,
    );
    this.nitroGain.gain.setTargetAtTime(nitro ? 0.12 : 0, t, 0.05);
  }

  setPaused(paused: boolean): void {
    this.out.gain.setTargetAtTime(paused ? 0 : 1, this.ctx.currentTime, 0.08);
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const s of this.sources) {
      try {
        s.stop(t + 0.3);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => this.out.disconnect(), 500);
  }
}
