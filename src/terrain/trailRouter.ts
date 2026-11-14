import { clamp, lerp } from '../math/util';
import type { TrailDef } from '../data/types';
import type { Mountain } from './mountain';

/** Dense 1 m centre line of a trail with headings (radians from +Z towards +X). */
export interface DenseLine {
  x: number[];
  z: number[];
  h: number[];
}

const CELL = 32;
// 16-neighbourhood: straight, diagonal and knight moves give smoother angles.
const OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
];

/** Minimal binary heap keyed by float cost. */
class Heap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  pop(): number {
    const top = this.vals[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }
}

/**
 * Routes trails across the natural terrain. The cost favours the target grade and heavily
 * penalises grades above the limit, so routes follow the contour lines and form hairpins
 * where the face is steep – exactly how real mountain tracks are built.
 */
export class TrailRouter {
  private readonly n: number;
  private readonly heights: Float32Array;
  private readonly min: number;
  /** Cells already used by routed trails: new routes avoid running alongside them. */
  private readonly occupied: Uint8Array;

  constructor(private readonly mountain: Mountain) {
    const half = mountain.def.halfSize;
    this.min = -half;
    this.n = Math.floor((2 * half) / CELL) + 1;
    this.heights = new Float32Array(this.n * this.n);
    this.occupied = new Uint8Array(this.n * this.n);
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++)
        this.heights[j * this.n + i] = mountain.heightNoWater(
          this.min + i * CELL,
          this.min + j * CELL,
        );
  }

  private node(x: number, z: number): number {
    const i = clamp(Math.round((x - this.min) / CELL), 0, this.n - 1);
    const j = clamp(Math.round((z - this.min) / CELL), 0, this.n - 1);
    return j * this.n + i;
  }

  /** Grade-limited A* between two points; returns grid node positions. */
  private route(ax: number, az: number, bx: number, bz: number, def: TrailDef): [number, number][] {
    const n = this.n;
    const H = this.heights;
    const m = this.mountain.def;
    const start = this.node(ax, az);
    const goal = this.node(bx, bz);
    const gi = goal % n;
    const gj = Math.floor(goal / n);
    const cost = new Float32Array(n * n).fill(Infinity);
    const from = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = new Heap();
    cost[start] = 0;
    heap.push(0, start);
    const span = Math.max(0.01, def.maxGrade - def.targetGrade);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) break;
      const ci = cur % n;
      const cj = Math.floor(cur / n);
      // Direction we arrived from (turn penalty: straighter legs, fewer, wider hairpins).
      const par = from[cur];
      let pdx = 0;
      let pdz = 0;
      if (par >= 0) {
        pdx = ci - (par % n);
        pdz = cj - Math.floor(par / n);
        const pl = Math.hypot(pdx, pdz) || 1;
        pdx /= pl;
        pdz /= pl;
      }
      for (const [oi, oj] of OFFSETS) {
        const ni = ci + oi;
        const nj = cj + oj;
        if (ni < 1 || nj < 1 || ni >= n - 1 || nj >= n - 1) continue;
        const nb = nj * n + ni;
        if (closed[nb]) continue;
        const len = Math.hypot(oi, oj) * CELL;
        const grade = Math.abs(H[nb] - H[cur]) / len;
        let c = len * (1 + 3 * (Math.max(0, grade - def.targetGrade) / span) ** 2);
        if (grade > def.maxGrade * 1.15) c *= 40;
        if (par >= 0) c += len * 0.45 * (1 - (oi * pdx + oj * pdz) / Math.hypot(oi, oj));
        // Keep away from the lake, the map rim and very steep cross slopes.
        const wx = this.min + ni * CELL;
        const wz = this.min + nj * CELL;
        if (H[nb] < m.lake.level + 2.5) c *= 30;
        if (this.occupied[nb]) {
          // Allowed close to the junctions, strongly discouraged elsewhere.
          const dStart = Math.hypot(wx - ax, wz - az);
          const dGoal = Math.hypot(wx - bx, wz - bz);
          if (dStart > 90 && dGoal > 90) c *= 8;
        }
        if (Math.max(Math.abs(wx), Math.abs(wz)) > m.halfSize * 0.8) c *= 8;
        const nc = cost[cur] + c;
        if (nc < cost[nb]) {
          cost[nb] = nc;
          from[nb] = cur;
          heap.push(nc + Math.hypot(ni - gi, nj - gj) * CELL, nb);
        }
      }
    }
    const path: [number, number][] = [];
    let cur = goal;
    if (from[goal] < 0 && goal !== start)
      return [
        [ax, az],
        [bx, bz],
      ];
    while (cur !== -1) {
      path.push([this.min + (cur % n) * CELL, this.min + Math.floor(cur / n) * CELL]);
      if (cur === start) break;
      cur = from[cur];
    }
    path.reverse();
    path[0] = [ax, az];
    path[path.length - 1] = [bx, bz];
    return path;
  }

  /** Marks the cells around a routed path (one cell of margin) as occupied. */
  private markOccupied(path: [number, number][]): void {
    const n = this.n;
    for (let k = 1; k < path.length; k++) {
      const [x0, z0] = path[k - 1];
      const [x1, z1] = path[k];
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.5)) + 1;
      for (let t = 0; t <= steps; t++) {
        const x = x0 + ((x1 - x0) * t) / steps;
        const z = z0 + ((z1 - z0) * t) / steps;
        const ci = Math.round((x - this.min) / CELL);
        const cj = Math.round((z - this.min) / CELL);
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const i = ci + di;
            const j = cj + dj;
            if (i >= 0 && j >= 0 && i < n && j < n) this.occupied[j * n + i] = 1;
          }
      }
    }
  }

  /** Routes a trail through its waypoints and returns a smooth dense centre line. */
  routeTrail(def: TrailDef, existing: Map<string, DenseLine>): DenseLine {
    const wps = def.waypoints.map((w) => [w[0], w[1]] as [number, number]);
    const snap = (id: string | undefined, w: [number, number]): void => {
      const line = id ? existing.get(id) : undefined;
      if (!line) return;
      const [tx, tz] = w;
      let best = Infinity;
      for (let i = 0; i < line.x.length; i += 2) {
        const d = Math.hypot(line.x[i] - tx, line.z[i] - tz);
        if (d < best) {
          best = d;
          w[0] = line.x[i];
          w[1] = line.z[i];
        }
      }
    };
    snap(def.startOn, wps[0]);
    snap(def.endOn, wps[wps.length - 1]);
    let pts: [number, number][] = [];
    for (let k = 0; k < wps.length - 1; k++) {
      const leg = this.route(wps[k][0], wps[k][1], wps[k + 1][0], wps[k + 1][1], def);
      pts = pts.concat(k === 0 ? leg : leg.slice(1));
      this.markOccupied(leg);
    }
    // Remove the grid staircase first, then round corners into curves and hairpins.
    pts = simplify(pts, 11);
    // Chaikin corner cutting.
    for (let it = 0; it < 3; it++) {
      const out: [number, number][] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[i + 1];
        out.push(
          [lerp(x0, x1, 0.25), lerp(z0, z1, 0.25)],
          [lerp(x0, x1, 0.75), lerp(z0, z1, 0.75)],
        );
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return densify(relax(densify(pts), 9));
  }
}

/**
 * Curvature-limited relaxation: points where the bend radius (measured over ±6 m) is below
 * `minRadius` move towards their chord midpoint until every bend is wide enough to drive.
 */
export function relax(line: DenseLine, minRadius: number): [number, number][] {
  const x = line.x.slice();
  const z = line.z.slice();
  const n = x.length;
  const k = 6;
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = k; i < n - k; i++) {
      const ax = x[i - k];
      const az = z[i - k];
      const bx = x[i + k];
      const bz = z[i + k];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      // Radius of the circle through the three points: R = abc / (4 * area).
      const a = Math.hypot(x[i] - ax, z[i] - az);
      const b = Math.hypot(bx - x[i], bz - z[i]);
      const c = Math.hypot(bx - ax, bz - az);
      const area = Math.abs((x[i] - ax) * (bz - az) - (z[i] - az) * (bx - ax)) / 2;
      if (area < 1e-6) continue;
      const r = (a * b * c) / (4 * area);
      if (r < minRadius) {
        x[i] += (mx - x[i]) * 0.3;
        z[i] += (mz - z[i]) * 0.3;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return x.map((v, i) => [v, z[i]] as [number, number]);
}

/** Resamples a polyline at 1 m and computes smoothed headings. */
export function densify(pts: [number, number][]): DenseLine {
  const xs: number[] = [pts[0][0]];
  const zs: number[] = [pts[0][1]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 1e-6) continue;
    let pos = 1 - acc;
    while (pos <= d) {
      xs.push(ax + ((bx - ax) * pos) / d);
      zs.push(az + ((bz - az) * pos) / d);
      pos += 1;
    }
    acc = d - (pos - 1);
  }
  // Positional smoothing (two passes of ±10 m) removes the last kinks; the window shrinks
  // near the ends so junction points stay where they are.
  const n = xs.length;
  let sx = xs.slice();
  let sz = zs.slice();
  for (let pass = 0; pass < 2; pass++) {
    const nx = new Array<number>(n);
    const nz = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const w = Math.min(10, i, n - 1 - i);
      let ax = 0;
      let az = 0;
      for (let o = -w; o <= w; o++) {
        ax += sx[i + o];
        az += sz[i + o];
      }
      nx[i] = ax / (2 * w + 1);
      nz[i] = az / (2 * w + 1);
    }
    sx = nx;
    sz = nz;
  }
  // Resample the smoothed line at exactly 1 m so samples are evenly spaced.
  const rx: number[] = [sx[0]];
  const rz: number[] = [sz[0]];
  let carry = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(sx[i] - sx[i - 1], sz[i] - sz[i - 1]);
    if (d < 1e-9) continue;
    let pos = 1 - carry;
    while (pos <= d) {
      rx.push(sx[i - 1] + ((sx[i] - sx[i - 1]) * pos) / d);
      rz.push(sz[i - 1] + ((sz[i] - sz[i - 1]) * pos) / d);
      pos += 1;
    }
    carry = d - (pos - 1);
  }
  if (Math.hypot(rx[rx.length - 1] - sx[n - 1], rz[rz.length - 1] - sz[n - 1]) > 0.3) {
    rx.push(sx[n - 1]);
    rz.push(sz[n - 1]);
  }
  sx = rx;
  sz = rz;
  const m = sx.length;
  const hs: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 2);
    const b = Math.min(m - 1, i + 2);
    hs.push(Math.atan2(sx[b] - sx[a], sz[b] - sz[a]));
  }
  return { x: sx, z: sz, h: hs };
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(pts: [number, number][], tolerance: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    let worst = -1;
    let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst > tolerance) {
      keep[wi] = 1;
      stack.push([a, wi], [wi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
