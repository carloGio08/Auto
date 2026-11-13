import type { Renderer } from '../core/renderer';

/** Small FPS / quality overlay (Settings → Show FPS, or F3). */
export class FpsMeter {
  private readonly el: HTMLDivElement;
  private acc = 0;
  private frames = 0;
  private visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'fps-meter';
    this.el.hidden = true;
    document.body.append(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.hidden = !v;
  }

  update(dt: number, frameMs: number, renderer: Renderer): void {
    if (!this.visible) return;
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const info = renderer.gl.info.render;
    this.el.textContent = `${Math.round(this.frames / this.acc)} fps · ${frameMs.toFixed(1)} ms · ${renderer.presetId} ×${renderer.scale.toFixed(2)} · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
    this.acc = 0;
    this.frames = 0;
  }
}
