/**
 * Simplified erosion on a square heightmap (row-major, n × n, `spacing` metres apart).
 * Everything works in place on typed arrays with no per-cell allocation.
 */

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Thermal erosion: where the drop to a neighbour exceeds the talus slope, part of the excess
 * slides down. Rounds sharp edges and builds scree aprons at the foot of steep faces.
 */
export function thermalErosion(
  h: Float32Array,
  n: number,
  spacing: number,
  talus: number,
  iterations: number,
  rate = 0.5,
): void {
  for (let it = 0; it < iterations; it++) {
    // Alternate the sweep direction so material does not drift one way.
    const rev = it & 1;
    for (let jj = 1; jj < n - 1; jj++) {
      const j = rev ? n - 1 - jj : jj;
      for (let ii = 1; ii < n - 1; ii++) {
        const i = rev ? n - 1 - ii : ii;
        const c = j * n + i;
        const hc = h[c];
        let total = 0;
        let maxEx = 0;
        for (let k = 0; k < 8; k++) {
          const ex = hc - h[c + DJ[k] * n + DI[k]] - talus * spacing * DIST[k];
          if (ex > 0) {
            total += ex;
            if (ex > maxEx) maxEx = ex;
          }
        }
        if (total <= 0) continue;
        const move = maxEx * rate * 0.5;
        h[c] = hc - move;
        for (let k = 0; k < 8; k++) {
          const o = c + DJ[k] * n + DI[k];
          const ex = hc - h[o] - talus * spacing * DIST[k];
          if (ex > 0) h[o] += (move * ex) / total;
        }
      }
    }
  }
}

/** Binary min-heap on float keys with int payloads (fixed capacity). */
class FloatHeap {
  private readonly keys: Float64Array;
  private readonly vals: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(key: number, val: number): void {
    let i = this.size++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const key = keys[--this.size];
    const val = vals[this.size];
    let i = 0;
    const size = this.size;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= size) break;
      if (c + 1 < size && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= key) break;
      keys[i] = keys[c];
      vals[i] = vals[c];
      i = c;
    }
    keys[i] = key;
    vals[i] = val;
    return top;
  }
}

export interface FlowGraph {
  /** Cells in processing order: outlets first, each cell after its receiver. */
  order: Int32Array;
  /** Downstream neighbour of each cell (-1 for outlets). */
  receiver: Int32Array;
  /** Upstream area in cells. */
  area: Float32Array;
}

/**
 * Priority-flood flow routing (Barnes et al.): starting from the outlets (map border and
 * `outlet` cells such as the lake), cells are visited by increasing filled height; each
 * cell drains to the neighbour that reached it. Depressions are crossed without being
 * filled in the heightmap (they stay as natural hollows). Then flow accumulation.
 */
export function flowGraph(h: Float32Array, n: number, outlet: Uint8Array): FlowGraph {
  const N = n * n;
  const order = new Int32Array(N);
  const receiver = new Int32Array(N).fill(-1);
  const filled = new Float32Array(N);
  const seen = new Uint8Array(N);
  const heap = new FloatHeap(N);
  for (let c = 0; c < N; c++) {
    const i = c % n;
    const j = (c - i) / n;
    if (outlet[c] || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
      seen[c] = 1;
      filled[c] = h[c];
      heap.push(h[c], c);
    }
  }
  let k = 0;
  while (heap.size) {
    const c = heap.pop();
    order[k++] = c;
    const i = c % n;
    const j = (c - i) / n;
    const fc = filled[c];
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d];
      const nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const o = nj * n + ni;
      if (seen[o]) continue;
      seen[o] = 1;
      receiver[o] = c;
      const f = Math.max(h[o], fc + 1e-3);
      filled[o] = f;
      heap.push(f, o);
    }
  }
  const area = new Float32Array(N).fill(1);
  for (let q = N - 1; q >= 0; q--) {
    const c = order[q];
    const r = receiver[c];
    if (r >= 0) area[r] += area[c];
  }
  return { order, receiver, area };
}

/**
 * Implicit stream-power incision (Braun & Willett): processed from the outlets upstream so
 * each cell erodes towards its already-eroded receiver. Valleys deepen where flow gathers.
 */
export function streamPower(
  h: Float32Array,
  n: number,
  spacing: number,
  g: FlowGraph,
  strength: number,
): void {
  const { order, receiver, area } = g;
  for (let q = 0; q < order.length; q++) {
    const c = order[q];
    const r = receiver[c];
    if (r < 0) continue;
    const di = Math.abs((c % n) - (r % n));
    const dist = spacing * (di && Math.abs(c - r) !== di ? Math.SQRT2 : 1);
    const F = (strength * Math.sqrt(area[c])) / dist;
    const target = (h[c] + F * h[r]) / (1 + F);
    if (target < h[c] && h[c] > h[r]) h[c] = Math.max(target, h[r]);
  }
}

/**
 * Smooths valley floors: a blur weighted by accumulated flow (alluvial flats where streams
 * meander, untouched slopes elsewhere).
 */
export function smoothFloors(
  h: Float32Array,
  n: number,
  area: Float32Array,
  amount: number,
  minArea: number,
  maxArea: number,
): void {
  if (amount <= 0) return;
  const src = h.slice();
  const lo = Math.log(minArea);
  const hi = Math.log(maxArea);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      const t = (Math.log(area[c]) - lo) / (hi - lo);
      if (t <= 0) continue;
      const w = Math.min(1, t) * amount;
      const avg =
        (src[c - 1] + src[c + 1] + src[c - n] + src[c + n]) * 0.15 +
        (src[c - n - 1] + src[c - n + 1] + src[c + n - 1] + src[c + n + 1]) * 0.075 +
        src[c] * 0.1;
      h[c] = src[c] + (avg - src[c]) * w;
    }
  }
}

/** Box blur of a float grid (in place), `passes` times with radius 1. */
export function blur(a: Float32Array, n: number, passes: number): void {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const l = i > 0 ? a[c - 1] : a[c];
        const r = i < n - 1 ? a[c + 1] : a[c];
        tmp[c] = (l + a[c] + r) / 3;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const u = j > 0 ? tmp[c - n] : tmp[c];
        const d = j < n - 1 ? tmp[c + n] : tmp[c];
        a[c] = (u + tmp[c] + d) / 3;
      }
    }
  }
}

/**
 * Slope limiter (two-pass chamfer sweeps, like a distance transform): no cell may rise more
 * than `limit[c] × distance` above a neighbour, so over-steep walls are cut back to the
 * talus angle from the top. `limit` lets rugged cells (cirque walls, crags) stay steeper.
 */
export function limitSlope(
  h: Float32Array,
  n: number,
  spacing: number,
  limit: (c: number) => number,
  passes = 3,
): void {
  const d1 = spacing;
  const d2 = spacing * Math.SQRT2;
  for (let p = 0; p < passes; p++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const c = j * n + i;
        const L = limit(c);
        let v = h[c];
        v = Math.min(v, h[c - 1] + L * d1, h[c - n] + L * d1);
        v = Math.min(v, h[c - n - 1] + L * d2, h[c - n + 1] + L * d2);
        h[c] = v;
      }
    }
    for (let j = n - 2; j >= 1; j--) {
      for (let i = n - 2; i >= 1; i--) {
        const c = j * n + i;
        const L = limit(c);
        let v = h[c];
        v = Math.min(v, h[c + 1] + L * d1, h[c + n] + L * d1);
        v = Math.min(v, h[c + n + 1] + L * d2, h[c + n - 1] + L * d2);
        h[c] = v;
      }
    }
  }
}
