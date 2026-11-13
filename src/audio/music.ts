/**
 * Generative ambient music: slow pad chords plus a sparse pentatonic pluck melody, scheduled
 * ahead of time with a lookahead timer. Two moods: calm (menus) and drive (in game).
 */
const CHORDS = [
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [48, 52, 55, 59], // Cmaj7
  [55, 59, 62, 65], // G7
];
const SCALE = [69, 72, 74, 76, 79, 81, 84];
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar = 0;
  private bar = 0;
  private mood: 'calm' | 'drive' = 'calm';
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly delay: DelayNode;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1800;
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(this.filter);
    this.filter.connect(this.out).connect(dest);
  }

  play(mood: 'calm' | 'drive'): void {
    this.mood = mood;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(mood === 'calm' ? 0.5 : 0.32, t, 0.8);
    if (this.timer) return;
    this.nextBar = t + 0.1;
    this.timer = setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop(): void {
    this.out.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.5);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const barLen = this.mood === 'calm' ? 4.8 : 3.2;
    while (this.nextBar < this.ctx.currentTime + 1.5) {
      const chord = CHORDS[this.bar % CHORDS.length];
      chord.forEach((n, i) => this.pad(midi(n), this.nextBar, barLen, i));
      this.bass(midi(chord[0] - 12), this.nextBar, barLen);
      const notes = this.mood === 'calm' ? 3 : 6;
      for (let k = 0; k < notes; k++) {
        if (Math.random() < 0.6) {
          const n = SCALE[Math.floor(Math.random() * SCALE.length)];
          this.pluck(midi(n), this.nextBar + (k * barLen) / notes);
        }
      }
      this.nextBar += barLen;
      this.bar++;
    }
  }

  private pad(freq: number, t: number, len: number, voice: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = (voice - 1.5) * 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + len * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
    osc.connect(g).connect(this.filter);
    osc.start(t);
    osc.stop(t + len * 1.1);
  }

  private bass(freq: number, t: number, len: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(this.mood === 'drive' ? 0.09 : 0.05, t + 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(this.filter);
    osc.start(t);
    osc.stop(t + len + 0.1);
  }

  private pluck(freq: number, t: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(g);
    g.connect(this.filter);
    g.connect(this.delay);
    osc.start(t);
    osc.stop(t + 1.3);
  }
}
