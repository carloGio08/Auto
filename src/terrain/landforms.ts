import { Simplex2 } from '../math/noise';
import { clamp, smoothstep } from '../math/util';
import type { LandformDef, MountainDef } from '../data/types';

/** Polynomial smooth minimum: blends two surfaces over a band of width k (no seam). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

/** Polynomial smooth maximum. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Monotone cubic (Fritsch–Carlson) curve through keyframes: no overshoot between keys. */
export class MonotoneCurve {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly ms: number[];

  constructor(keys: [number, number][]) {
    const k = [...keys].sort((a, b) => a[0] - b[0]);
    this.xs = k.map((p) => p[0]);
    this.ys = k.map((p) => p[1]);
    const n = k.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++)
      d.push((this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i] || 1e-9));
    const m = new Array<number>(n).fill(0);
    m[0] = d[0] ?? 0;
    m[n - 1] = d[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    this.ms = m;
  }

  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.ys[i] +
      (t3 - 2 * t2 + t) * h * this.ms[i] +
      (-2 * t3 + 3 * t2) * this.ys[i + 1] +
      (t3 - t2) * h * this.ms[i + 1]
    );
  }
}

/** Closest point on a polyline: distance, arc length and signed side. Reused output. */
interface PathHit {
  d: number;
  s: number;
  side: number;
}

/** Pre-processed landform (bounds, resampled paths, per-landform targets). */
interface Prepared {
  def: LandformDef;
  kind: LandformDef['kind'];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  px: Float64Array;
  pz: Float64Array;
  /** Arc length at each path vertex. */
  ps: Float64Array;
  length: number;
  /** Valley floor altitude sampled every FLOOR_STEP m along the path. */
  floor: Float64Array;
  /** Target altitude (plateau, meadow, saddle, cirque, basin). */
  target: number;
  blend: number;
  rugged: number;
  wall: number;
  /** Outline wobble phase. */
  phase: number;
}

const FLOOR_STEP = 30;

/** Even slope with rounded ends (no kink at the summit plateau or the valley floor). */
function roundedRamp(t: number): number {
  const a = 0.15;
  const k = 2 * a * (1 - a);
  if (t < a) return (t * t) / k;
  if (t > 1 - a) return 1 - ((1 - t) * (1 - t)) / k;
  return (t - a / 2) / (1 - a);
}

/**
 * Evaluates the designed shape of a mountain: the warped massif with its radial terrace
 * profile, broad undulations, the map rim and every landform blended in with smooth
 * min/max. Pure and deterministic from the definition; sampled once per heightmap cell by
 * the generator (then eroded), never per frame.
 */
export class LandformField {
  private readonly warpNoise: Simplex2;
  private readonly noise: Simplex2;
  private readonly shapeNoise: Simplex2;
  private readonly profile: MonotoneCurve;
  private readonly tPlateau: number;
  private readonly forms: Prepared[] = [];
  private readonly hit: PathHit = { d: 0, s: 0, side: 0 };
  /** Rockiness of the last evaluated point (0..1). */
  rough = 0;

  constructor(private readonly def: MountainDef) {
    this.warpNoise = new Simplex2(def.seed ^ 0x5bd1e995);
    this.noise = new Simplex2(def.seed);
    this.shapeNoise = new Simplex2(def.seed ^ 0x2c1b3c6d);
    this.profile = new MonotoneCurve(def.profile);
    const minR = Math.min(def.radii.north, def.radii.south, def.radii.east, def.radii.west);
    this.tPlateau = def.summit.plateauRadius / minR;
    def.landforms.forEach((lf, k) => this.forms.push(this.prepare(lf, k)));
  }

  /** Massif: warped elliptical distance through the radial profile, plus broad noise. */
  private massif(x: number, z: number): number {
    const d = this.def;
    const n = d.noise;
    const ws = 1 / n.warpScale;
    const wx = x + n.warp * this.warpNoise.fbm(x * ws, z * ws, 2);
    const wz = z + n.warp * this.warpNoise.fbm(x * ws + 31.4, z * ws - 17.3, 2);
    const dx = wx - d.summit.x;
    const dz = wz - d.summit.z;
    // Radii blend smoothly with the direction (no kink through the summit).
    const ex = smoothstep(-400, 400, dx);
    const ez = smoothstep(-400, 400, dz);
    const rx = d.radii.west + (d.radii.east - d.radii.west) * ex;
    const rz = d.radii.north + (d.radii.south - d.radii.north) * ez;
    const t = Math.sqrt((dx / rx) * (dx / rx) + (dz / rz) * (dz / rz));
    // Stepped profile where the terracing noise says so, an even rounded slope elsewhere.
    const tp = this.tPlateau;
    const even = 1 - roundedRamp(clamp((t - tp) / (1 - tp), 0, 1));
    const ts = d.terracing.scale;
    const w =
      d.terracing.amount *
      smoothstep(-0.35, 0.35, this.shapeNoise.fbm(x / ts + 7.1, z / ts - 3.3, 2) + 0.15);
    const f = even + (this.profile.at(t) - even) * w;
    let h = d.baseHeight + (d.summit.height - d.baseHeight) * f;
    // The valley floor rises gently away from the lake so everything drains into it.
    const lake = Math.hypot(x - d.lake.x, z - d.lake.z);
    h += 0.014 * Math.max(0, lake - d.lake.radius) * (1 - smoothstep(0.6, 1.0, 1 - t));
    const calm = 0.25 + 0.75 * smoothstep(this.tPlateau, this.tPlateau + 0.1, t);
    h +=
      n.broad.amplitude *
      this.noise.fbm(x / n.broad.scale, z / n.broad.scale, 3) *
      calm *
      (1 - 0.6 * smoothstep(0.85, 1.05, t));
    // Natural boundary: ridges rising towards the map border.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > d.halfSize * 0.8) {
      const rim = smoothstep(d.halfSize * 0.82, d.halfSize * 1.15, edge);
      h += d.rimHeight * rim * (0.75 + 0.25 * this.noise.fbm(x / 900 + 5.5, z / 900, 2));
    }
    return h;
  }

  /** Full designed height at a point, and `rough` for it. */
  height(x: number, z: number): number {
    return this.evalUpTo(this.forms.length, x, z);
  }

  private evalUpTo(count: number, x: number, z: number): number {
    let h = this.massif(x, z);
    let rough = 0;
    for (let k = 0; k < count; k++) {
      const f = this.forms[k];
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      const r = this.apply(f, x, z, h);
      h = r;
      rough = Math.max(rough * (1 - this.flatten), this.roughHere);
    }
    this.rough = rough;
    return h;
  }

  /** Set by apply(): rockiness contributed and how much the landform smooths. */
  private roughHere = 0;
  private flatten = 0;

  private apply(f: Prepared, x: number, z: number, h: number): number {
    this.roughHere = 0;
    this.flatten = 0;
    const R = f.def.radius;
    switch (f.kind) {
      case 'ridge': {
        const p = this.pathDistance(f, x, z);
        const u = p.d / R;
        if (u >= 1) return h;
        // Rounded crest, fading at both ends.
        const env = smoothstep(0, 0.12, p.s / f.length) * (1 - smoothstep(0.8, 1, p.s / f.length));
        const bump = (1 - u * u) * (1 - u * u);
        this.roughHere = f.rugged * bump * env;
        return smax(h, h + f.def.height * bump * env, f.blend * 0.3);
      }
      case 'slope': {
        const p = this.pathDistance(f, x, z);
        if (p.d > R * 1.5) return h;
        const along = p.s / f.length;
        const env = smoothstep(0, 0.2, along) * (1 - smoothstep(0.8, 1, along));
        const v = p.side * p.d;
        const step = smoothstep(-R, R, v) - 0.5;
        this.roughHere = f.rugged * env * (1 - smoothstep(0, R, p.d));
        return h + f.def.height * step * env;
      }
      case 'valley': {
        const p = this.pathDistance(f, x, z);
        if (p.d > R + f.blend) return h;
        const fi = Math.min(f.floor.length - 1.001, p.s / FLOOR_STEP);
        const i0 = Math.floor(fi);
        const floor = f.floor[i0] + (f.floor[i0 + 1] - f.floor[i0]) * (fi - i0);
        const floorHalf = R * 0.3;
        const wallH = floor + f.wall * Math.max(0, p.d - floorHalf);
        const carved = smin(h, wallH, f.blend);
        // Fade in after the head of the valley and stay inside the radius.
        const k = smoothstep(0, 120, p.s) * (1 - smoothstep(R, R + f.blend, p.d));
        this.roughHere = f.rugged * k * smoothstep(floorHalf, R, p.d);
        this.flatten = k * (1 - smoothstep(floorHalf * 0.6, floorHalf * 1.6, p.d));
        return h + (carved - h) * k;
      }
      case 'cirque':
      case 'basin':
      case 'saddle': {
        const d = this.outlineDistance(f, x, z);
        if (d > R + f.blend + 200) return h;
        const floorR = f.kind === 'saddle' ? R * 0.35 : R * 0.45;
        const bowl = f.target + f.wall * Math.max(0, d - floorR);
        const carved = smin(h, bowl, f.blend);
        const k = 1 - smoothstep(R, R + f.blend + 200, d);
        if (f.kind === 'cirque') this.roughHere = f.rugged * k * smoothstep(floorR, R, d);
        this.flatten = k * (1 - smoothstep(floorR * 0.7, floorR * 1.3, d));
        return h + (carved - h) * k;
      }
      case 'plateau':
      case 'meadow': {
        const d = this.outlineDistance(f, x, z);
        // The rim of the flat ramps over a band that widens with the height to absorb, so
        // terraces never end in a wall (edge slope below ~25°).
        const band = Math.max(f.blend, Math.abs(h - f.target) * 2.6);
        if (d > R + band * 0.5) return h;
        const w = 1 - smoothstep(R - band * 0.5, R + band * 0.5, d);
        const strength = f.kind === 'meadow' ? 0.9 : 0.97;
        let target = f.target;
        if (f.kind === 'meadow')
          target += 0.12 * f.def.radius * 0.1 * this.shapeNoise.fbm(x / 170 + f.phase, z / 170, 2);
        this.flatten = w;
        return h + (target - h) * w * strength;
      }
      case 'hills': {
        const d = Math.hypot(x - f.def.at![0], z - f.def.at![1]);
        if (d > R + f.blend) return h;
        const w = 1 - smoothstep(R - f.blend, R + f.blend, d);
        const sc = Math.max(260, R / 2.5);
        const bumps = 0.5 + 0.5 * this.shapeNoise.fbm(x / sc + f.phase, z / sc - f.phase, 2);
        this.roughHere = f.rugged * w * 0.5;
        return h + f.def.height * bumps * bumps * w;
      }
    }
    return h;
  }

  /** Distance to an organic (noise-wobbled) outline around `at`: <= radius inside. */
  private outlineDistance(f: Prepared, x: number, z: number): number {
    const [cx, cz] = f.def.at!;
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    const a = Math.atan2(dx, dz);
    const wob =
      0.16 * Math.sin(a * 2 + f.phase) +
      0.1 * Math.sin(a * 3 - f.phase * 1.7) +
      0.06 * Math.sin(a * 5 + f.phase * 2.3);
    return d / (1 + wob);
  }

  private pathDistance(f: Prepared, x: number, z: number): PathHit {
    const out = this.hit;
    out.d = Infinity;
    const px = f.px;
    const pz = f.pz;
    for (let i = 0; i < px.length - 1; i++) {
      const ax = px[i];
      const az = pz[i];
      const dx = px[i + 1] - ax;
      const dz = pz[i + 1] - az;
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const ex = x - (ax + dx * t);
      const ez = z - (az + dz * t);
      const d = Math.hypot(ex, ez);
      if (d < out.d) {
        out.d = d;
        out.s = f.ps[i] + t * Math.sqrt(l2);
        out.side = dx * ez - dz * ex >= 0 ? 1 : -1;
      }
    }
    return out;
  }

  private prepare(lf: LandformDef, k: number): Prepared {
    const blend = lf.blend ?? Math.max(30, lf.radius * 0.4);
    const pts = lf.path ?? (lf.at ? [lf.at] : [[0, 0]]);
    // Paths are smoothed (Chaikin) so ridges and valleys curve naturally.
    let path = pts.map((p) => [p[0], p[1]] as [number, number]);
    if (lf.path && path.length > 2) {
      for (let it = 0; it < 3; it++) {
        const o: [number, number][] = [path[0]];
        for (let i = 0; i < path.length - 1; i++) {
          const [x0, z0] = path[i];
          const [x1, z1] = path[i + 1];
          o.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25]);
          o.push([x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
        }
        o.push(path[path.length - 1]);
        path = o;
      }
    }
    const px = Float64Array.from(path.map((p) => p[0]));
    const pz = Float64Array.from(path.map((p) => p[1]));
    const ps = new Float64Array(path.length);
    for (let i = 1; i < path.length; i++)
      ps[i] = ps[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    const reach = lf.radius * 1.6 + blend + 420;
    const f: Prepared = {
      def: lf,
      kind: lf.kind,
      minX: Math.min(...px) - reach,
      maxX: Math.max(...px) + reach,
      minZ: Math.min(...pz) - reach,
      maxZ: Math.max(...pz) + reach,
      px,
      pz,
      ps,
      length: ps[ps.length - 1] || 1,
      floor: new Float64Array(0),
      target: 0,
      blend,
      rugged: lf.rugged ?? 0,
      wall: lf.wall ?? 0.5,
      phase: k * 1.913 + (this.def.seed % 101) * 0.07,
    };
    // Targets are measured on the surface built by the previous landforms.
    if (lf.at) {
      const base = this.evalUpTo(k, lf.at[0], lf.at[1]);
      f.target =
        lf.kind === 'plateau' || lf.kind === 'meadow' ? base + lf.height : base - lf.height;
    }
    if (lf.kind === 'valley') {
      // Floor: the lowest surface met so far minus the depth, never rising downstream,
      // then smoothed so the stream bed descends evenly through terraces (gorges at faces).
      const steps = Math.max(2, Math.ceil(f.length / FLOOR_STEP) + 1);
      const fl = new Float64Array(steps);
      let seg = 0;
      let low = Infinity;
      for (let i = 0; i < steps; i++) {
        const s = Math.min(f.length, i * FLOOR_STEP);
        while (seg < path.length - 2 && ps[seg + 1] < s) seg++;
        const t = (s - ps[seg]) / (ps[seg + 1] - ps[seg] || 1);
        const x = px[seg] + (px[seg + 1] - px[seg]) * t;
        const z = pz[seg] + (pz[seg + 1] - pz[seg]) * t;
        low = Math.min(low, this.evalUpTo(k, x, z));
        fl[i] = low - lf.height;
      }
      for (let pass = 0; pass < 4; pass++) {
        const c = fl.slice();
        for (let i = 1; i < steps - 1; i++) fl[i] = (c[i - 1] + 2 * c[i] + c[i + 1]) / 4;
        for (let i = 1; i < steps; i++) fl[i] = Math.min(fl[i], fl[i - 1] - 0.2);
      }
      f.floor = fl;
    }
    return f;
  }
}
