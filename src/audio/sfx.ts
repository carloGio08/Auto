export function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0;
  for (let i = 0; i < len; i++) {
    // Slightly pink noise: white + one-pole low-pass mix.
    const white = Math.random() * 2 - 1;
    b0 = 0.97 * b0 + 0.03 * white;
    data[i] = white * 0.6 + b0 * 3;
  }
  return buf;
}

type Wave = OscillatorType;

/** One-shot procedural sound effects. */
export class Sfx {
  private lastPlayed = new Map<string, number>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {}

  /** Rate limiter so bursts of events do not stack dozens of voices. */
  private gate(name: string, minGap: number): boolean {
    const t = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (t - last < minGap) return false;
    this.lastPlayed.set(name, t);
    return true;
  }

  private tone(
    freq: number,
    dur: number,
    type: Wave,
    gain: number,
    when = 0,
    slideTo?: number,
  ): void {
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private burst(
    dur: number,
    gain: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 1,
    when = 0,
    freqTo?: number,
  ): void {
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  uiMove(): void {
    if (this.gate('uiMove', 0.04)) this.tone(660, 0.06, 'triangle', 0.08);
  }

  uiConfirm(): void {
    if (!this.gate('uiConfirm', 0.05)) return;
    this.tone(523, 0.08, 'triangle', 0.12);
    this.tone(784, 0.12, 'triangle', 0.1, 0.06);
  }

  uiBack(): void {
    if (this.gate('uiBack', 0.05)) this.tone(440, 0.1, 'triangle', 0.1, 0, 300);
  }

  uiError(): void {
    if (this.gate('uiError', 0.1)) this.tone(180, 0.18, 'square', 0.06, 0, 120);
  }

  purchase(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.11, i * 0.07));
  }

  coin(): void {
    if (!this.gate('coin', 0.03)) return;
    this.tone(988, 0.07, 'square', 0.06);
    this.tone(1319, 0.16, 'square', 0.05, 0.06);
  }

  crystal(): void {
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.09, i * 0.05));
  }

  trick(level: number): void {
    if (!this.gate('trick', 0.08)) return;
    const base = 520 * Math.pow(1.06, Math.min(level, 12));
    this.tone(base, 0.12, 'triangle', 0.08);
    this.tone(base * 1.5, 0.2, 'triangle', 0.07, 0.08);
  }

  comboLost(): void {
    this.tone(330, 0.3, 'sawtooth', 0.05, 0, 110);
  }

  achievement(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.09, i * 0.09));
  }

  medal(kind: 'gold' | 'silver' | 'bronze' | 'none'): void {
    if (kind === 'none') {
      this.tone(392, 0.4, 'triangle', 0.08, 0, 300);
      return;
    }
    const notes =
      kind === 'gold'
        ? [523, 659, 784, 1046, 1318]
        : kind === 'silver'
          ? [523, 659, 784, 1046]
          : [523, 659, 784];
    notes.forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.1, i * 0.11));
  }

  impact(strength: number): void {
    if (!this.gate('impact', 0.08)) return;
    const s = Math.min(1, strength);
    this.burst(0.25 + s * 0.3, 0.35 * s + 0.05, 'lowpass', 900 + s * 1500, 0.8);
    this.tone(70 + s * 30, 0.25, 'sine', 0.4 * s + 0.05, 0, 40);
  }

  landing(strength: number): void {
    if (!this.gate('landing', 0.12)) return;
    const s = Math.min(1, strength);
    this.tone(90, 0.22, 'sine', 0.25 + s * 0.3, 0, 45);
    this.burst(0.2, 0.15 * s + 0.04, 'lowpass', 600, 0.7);
  }

  splash(strength: number): void {
    if (!this.gate('splash', 0.25)) return;
    this.burst(0.8, 0.25 * Math.min(1, strength) + 0.08, 'bandpass', 1400, 0.6, 0, 500);
  }

  nitroStart(): void {
    if (!this.gate('nitro', 0.3)) return;
    this.burst(0.5, 0.18, 'bandpass', 600, 1.2, 0, 3200);
  }

  whoosh(): void {
    if (this.gate('whoosh', 0.2)) this.burst(0.35, 0.12, 'bandpass', 2400, 2, 0, 800);
  }

  rumble(): void {
    if (this.gate('rumble', 1)) this.burst(1.6, 0.35, 'lowpass', 220, 0.8, 0, 90);
  }
}
