/**
 * Uniform-grid index over the segments of one or more polylines, for fast "closest segment"
 * queries within a fixed influence radius. Used by rivers (and anything else that needs a
 * simple distance to a path).
 */
export interface PolylineHit {
  found: boolean;
  /** Index of the segment start point and parameter along the segment. */
  index: number;
  t: number;
  distance: number;
}

export const createPolylineHit = (): PolylineHit => ({
  found: false,
  index: 0,
  t: 0,
  distance: Infinity,
});

export class PolylineIndex {
  private readonly cell: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly w: number;
  private readonly h: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  /**
   * @param x,z point coordinates
   * @param valid valid[i] = 1 when the segment (i, i+1) exists (allows several polylines)
   * @param influence queries farther than this from every segment report found = false
   */
  constructor(
    readonly x: Float32Array,
    readonly z: Float32Array,
    readonly valid: Uint8Array,
    readonly influence: number,
    cell = 32,
  ) {
    this.cell = cell;
    const n = x.length;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, x[i]);
      maxX = Math.max(maxX, x[i]);
      minZ = Math.min(minZ, z[i]);
      maxZ = Math.max(maxZ, z[i]);
    }
    if (n === 0) minX = maxX = minZ = maxZ = 0;
    const pad = influence + cell;
    this.minX = minX - pad;
    this.minZ = minZ - pad;
    this.w = Math.max(1, Math.ceil((maxX - minX + 2 * pad) / cell));
    this.h = Math.max(1, Math.ceil((maxZ - minZ + 2 * pad) / cell));
    const counts = new Int32Array(this.w * this.h + 1);
    const forEachCell = (i: number, fn: (c: number) => void): void => {
      const x0 = Math.floor((Math.min(x[i], x[i + 1]) - influence - this.minX) / cell);
      const x1 = Math.floor((Math.max(x[i], x[i + 1]) + influence - this.minX) / cell);
      const z0 = Math.floor((Math.min(z[i], z[i + 1]) - influence - this.minZ) / cell);
      const z1 = Math.floor((Math.max(z[i], z[i + 1]) + influence - this.minZ) / cell);
      for (let cz = Math.max(0, z0); cz <= Math.min(this.h - 1, z1); cz++)
        for (let cx = Math.max(0, x0); cx <= Math.min(this.w - 1, x1); cx++) fn(cz * this.w + cx);
    };
    for (let i = 0; i < n - 1; i++) if (valid[i]) forEachCell(i, (c) => counts[c]++);
    this.start = new Int32Array(this.w * this.h + 1);
    let total = 0;
    for (let c = 0; c < this.w * this.h; c++) {
      this.start[c] = total;
      total += counts[c];
    }
    this.start[this.w * this.h] = total;
    this.items = new Int32Array(total);
    const fill = new Int32Array(this.w * this.h);
    for (let i = 0; i < n - 1; i++) {
      if (!valid[i]) continue;
      forEachCell(i, (c) => (this.items[this.start[c] + fill[c]++] = i));
    }
  }

  /** Index range [start, end) of candidate segments for a point, or null outside the grid. */
  cellRange(px: number, pz: number, out: [number, number]): boolean {
    const cx = Math.floor((px - this.minX) / this.cell);
    const cz = Math.floor((pz - this.minZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    const c = cz * this.w + cx;
    out[0] = this.start[c];
    out[1] = this.start[c + 1];
    return out[1] > out[0];
  }

  item(k: number): number {
    return this.items[k];
  }

  /** Closest segment within the influence radius. */
  nearest(px: number, pz: number, out: PolylineHit): PolylineHit {
    out.found = false;
    out.distance = Infinity;
    const range = rangeScratch;
    if (!this.cellRange(px, pz, range)) return out;
    const X = this.x;
    const Z = this.z;
    let best = Infinity;
    for (let k = range[0]; k < range[1]; k++) {
      const i = this.items[k];
      const ax = X[i];
      const az = Z[i];
      const dx = X[i + 1] - ax;
      const dz = Z[i + 1] - az;
      const l2 = dx * dx + dz * dz || 1e-6;
      let t = ((px - ax) * dx + (pz - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - px;
      const qz = az + dz * t - pz;
      const d2 = qx * qx + qz * qz;
      if (d2 < best) {
        best = d2;
        out.index = i;
        out.t = t;
      }
    }
    if (best === Infinity) return out;
    out.distance = Math.sqrt(best);
    out.found = out.distance <= this.influence;
    return out;
  }
}

const rangeScratch: [number, number] = [0, 0];
