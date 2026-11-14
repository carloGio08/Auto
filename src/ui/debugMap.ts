import type { Course } from '../terrain/course';

/** Slope classes of the generation targets (degrees) and their colours. */
const CLASSES: [number, string][] = [
  [8, '#8cc86e'],
  [25, '#d2cc78'],
  [38, '#d2965a'],
  [90, '#965050'],
];

/**
 * Development overlay (F4 in dev builds or with ?debug): a top-down map of the mountain with
 * the slope classes (flat < 8°, gentle/medium < 25°, steep < 38°, walls), hill shading,
 * water, every trail (main, branches, shortcuts, bridges and fords), the landforms of the
 * definition with their kind, and the jeep. The terrain image is computed once per course.
 */
export class DebugMap {
  readonly el: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private readonly size = 560;
  private readonly ext: number;
  visible = false;

  constructor(private readonly course: Course) {
    this.el = document.createElement('canvas');
    this.el.width = this.el.height = this.size;
    this.el.className = 'debug-map';
    this.el.style.cssText =
      'position:fixed;right:12px;top:72px;width:min(46vw,560px);height:auto;z-index:50;' +
      'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;display:none';
    this.ext = course.def.halfSize * 1.05;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size;
    document.body.appendChild(this.el);
  }

  private toPx(x: number, z: number): [number, number] {
    const k = this.size / (2 * this.ext);
    return [(x + this.ext) * k, (z + this.ext) * k];
  }

  /** Renders the static layer (slopes, shading, water, trails, landforms). */
  private renderBase(): void {
    const c = this.course;
    const m = c.mountain;
    const n = this.size;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    const cols = CLASSES.map(([, hex]) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
    const step = (2 * this.ext) / n;
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        const x = -this.ext + (px + 0.5) * step;
        const z = -this.ext + (py + 0.5) * step;
        const h = m.heightNoWater(x, z);
        const hx = m.heightNoWater(x + 2, z) - h;
        const hz = m.heightNoWater(x, z + 2) - h;
        const deg = (Math.atan(Math.hypot(hx, hz) / 2) * 180) / Math.PI;
        let k = 0;
        while (k < CLASSES.length - 1 && deg >= CLASSES[k][0]) k++;
        const l = Math.hypot(hx, 2, hz);
        const shade = Math.max(0, (-hx * 0.5 + 2 * 0.7 - hz * 0.5) / l / 0.95);
        const band = Math.floor(h / 100) % 2 ? 1 : 0.92;
        const water = m.waterLevel(x, z) > m.height(x, z) + 0.2;
        const col = water ? [70, 130, 200] : cols[k];
        const o = (py * n + px) * 4;
        for (let j = 0; j < 3; j++)
          img.data[o + j] = Math.min(255, col[j] * (0.4 + 0.7 * shade) * band);
        img.data[o + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Trails.
    const road = c.road;
    for (const [ti, tr] of road.trails.entries()) {
      ctx.strokeStyle =
        tr.def.kind === 'main' ? '#ffffff' : tr.def.kind === 'shortcut' ? '#ff6a3d' : '#ffe08a';
      ctx.lineWidth = tr.def.kind === 'main' ? 2 : 1.4;
      ctx.beginPath();
      for (let i = tr.start; i < tr.start + tr.count; i += 4) {
        const [px, py] = this.toPx(road.x[i], road.z[i]);
        if (i === tr.start) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      for (const b of road.bridges.filter((b) => b.trail === ti)) this.dot(ctx, b, ti, '#8b5a2b');
      for (const f of road.fords.filter((f) => f.trail === ti)) this.dot(ctx, f, ti, '#2f8fd8');
    }
    // Landforms.
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (const lf of c.def.landforms) {
      ctx.strokeStyle = 'rgba(20,20,30,0.55)';
      ctx.fillStyle = 'rgba(20,20,30,0.8)';
      const k = this.size / (2 * this.ext);
      if (lf.at) {
        const [px, py] = this.toPx(lf.at[0], lf.at[1]);
        ctx.beginPath();
        ctx.arc(px, py, lf.radius * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(lf.kind, px - 14, py + 3);
      } else if (lf.path) {
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        lf.path.forEach(([x, z], i) => {
          const [px, py] = this.toPx(x, z);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        const [px, py] = this.toPx(lf.path[1][0], lf.path[1][1]);
        ctx.fillText(lf.kind, px + 3, py);
      }
    }
  }

  private dot(
    ctx: CanvasRenderingContext2D,
    span: { from: number; to: number },
    trail: number,
    color: string,
  ): void {
    const p = this.course.road.pointAt(
      (span.from + span.to) / 2,
      {
        x: 0,
        y: 0,
        z: 0,
        tx: 0,
        tz: 1,
        halfWidth: 0,
        s: 0,
        index: 0,
      },
      trail,
    );
    const [px, py] = this.toPx(p.x, p.z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible && !this.baseReady) {
      this.renderBase();
      this.baseReady = true;
    }
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  private baseReady = false;

  /** Redraws the jeep marker (call per frame while visible). */
  update(x: number, z: number, heading: number): void {
    if (!this.visible) return;
    const ctx = this.el.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    const [px, py] = this.toPx(x, z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading);
    ctx.fillStyle = '#ff7a2f';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(5, -5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  dispose(): void {
    this.el.remove();
  }
}
