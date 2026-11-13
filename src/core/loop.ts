/**
 * Fixed-timestep game loop with accumulator and interpolation factor.
 * Rendering is delegated to the `render` callback once per animation frame.
 */
export interface LoopCallbacks {
  fixedUpdate(dt: number): void;
  update(dt: number, alpha: number): void;
  render(): void;
}

export class GameLoop {
  readonly step: number;
  private readonly maxSteps: number;
  private acc = 0;
  private last = 0;
  private rafId = 0;
  private running = false;
  /** Scales simulation time (slow motion). Rendering keeps going at full rate. */
  timeScale = 1;
  /** Smoothed frame time in ms, useful for adaptive quality. */
  frameMs = 16.7;
  /** Real (unscaled) dt of the last frame. */
  realDt = 1 / 60;

  constructor(
    private readonly cb: LoopCallbacks,
    hz = 120,
    maxSteps = 12,
  ) {
    this.step = 1 / hz;
    this.maxSteps = maxSteps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Advances one frame manually (used by tests and by the frame callback). */
  tick(realDt: number): void {
    this.realDt = realDt;
    const dt = Math.min(realDt, 0.1) * this.timeScale;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.cb.fixedUpdate(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0; // spiral-of-death guard
    this.cb.update(dt, this.acc / this.step);
    this.cb.render();
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const ms = now - this.last;
    this.last = now;
    this.frameMs += (Math.min(ms, 100) - this.frameMs) * 0.05;
    this.tick(ms / 1000);
  };
}
