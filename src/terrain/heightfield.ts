/**
 * Plain data of a generated heightmap: transferable between the generation worker, the
 * mesh worker and the main thread (typed arrays only).
 */
export interface HeightfieldData {
  /** Samples per side. */
  n: number;
  /** Distance between samples (m). */
  spacing: number;
  /** World X/Z of sample (0, 0). */
  min: number;
  /** Heights (m), row-major: index = j * n + i, x = min + i * spacing, z = min + j * spacing. */
  height: Float32Array;
  /** 0..255 wetness from flow accumulation (valleys, streams). */
  moisture: Uint8Array;
  /** 0..255 rockiness from the landforms (crests, cirque walls, steep faces). */
  rough: Uint8Array;
  /** 0..255 declared flat zones (meadows, terraces, valley floors, basins). */
  flat: Uint8Array;
}

/**
 * Sampling of a coarse heightmap. Heights use a uniform cubic B-spline: C2 continuous and
 * never overshooting, so the surface stays smooth with no spikes even where the grid is
 * steep. Moisture, rockiness and curvature are bilinear.
 */
export class Heightfield {
  readonly n: number;
  readonly spacing: number;
  readonly min: number;
  readonly h: Float32Array;
  private readonly inv: number;

  constructor(readonly data: HeightfieldData) {
    this.n = data.n;
    this.spacing = data.spacing;
    this.min = data.min;
    this.h = data.height;
    this.inv = 1 / data.spacing;
  }

  /** Smooth height (cubic B-spline). */
  sample(x: number, z: number): number {
    const n = this.n;
    const fx = (x - this.min) * this.inv;
    const fz = (z - this.min) * this.inv;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const tx2 = tx * tx;
    const tx3 = tx2 * tx;
    const tz2 = tz * tz;
    const tz3 = tz2 * tz;
    const ix = 1 - tx;
    const iz = 1 - tz;
    const wx0 = (ix * ix * ix) / 6;
    const wx1 = (3 * tx3 - 6 * tx2 + 4) / 6;
    const wx2 = (-3 * tx3 + 3 * tx2 + 3 * tx + 1) / 6;
    const wx3 = tx3 / 6;
    const wz0 = (iz * iz * iz) / 6;
    const wz1 = (3 * tz3 - 6 * tz2 + 4) / 6;
    const wz2 = (-3 * tz3 + 3 * tz2 + 3 * tz + 1) / 6;
    const wz3 = tz3 / 6;
    const h = this.h;
    const last = n - 1;
    // Fast path: fully inside.
    if (i >= 1 && j >= 1 && i < last - 1 && j < last - 1) {
      let o = (j - 1) * n + i - 1;
      const r0 = wx0 * h[o] + wx1 * h[o + 1] + wx2 * h[o + 2] + wx3 * h[o + 3];
      o += n;
      const r1 = wx0 * h[o] + wx1 * h[o + 1] + wx2 * h[o + 2] + wx3 * h[o + 3];
      o += n;
      const r2 = wx0 * h[o] + wx1 * h[o + 1] + wx2 * h[o + 2] + wx3 * h[o + 3];
      o += n;
      const r3 = wx0 * h[o] + wx1 * h[o + 1] + wx2 * h[o + 2] + wx3 * h[o + 3];
      return wz0 * r0 + wz1 * r1 + wz2 * r2 + wz3 * r3;
    }
    i = Math.max(-1, Math.min(last, i));
    j = Math.max(-1, Math.min(last, j));
    const c = (v: number): number => (v < 0 ? 0 : v > last ? last : v);
    const row = (jj: number): number => {
      const o = c(jj) * n;
      return (
        wx0 * h[o + c(i - 1)] + wx1 * h[o + c(i)] + wx2 * h[o + c(i + 1)] + wx3 * h[o + c(i + 2)]
      );
    };
    return wz0 * row(j - 1) + wz1 * row(j) + wz2 * row(j + 1) + wz3 * row(j + 2);
  }

  private bilinear8(a: Uint8Array, x: number, z: number): number {
    const last = this.n - 1;
    const fx = Math.max(0, Math.min(last - 1e-4, (x - this.min) * this.inv));
    const fz = Math.max(0, Math.min(last - 1e-4, (z - this.min) * this.inv));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const o = j * this.n + i;
    const n = this.n;
    const top = a[o] + (a[o + 1] - a[o]) * tx;
    const bot = a[o + n] + (a[o + n + 1] - a[o + n]) * tx;
    return (top + (bot - top) * tz) / 255;
  }

  /** Wetness 0..1 (valley floors, streams). */
  moisture(x: number, z: number): number {
    return this.bilinear8(this.data.moisture, x, z);
  }

  /** Declared flat zone 0..1 (meadows, terraces, valley floors). */
  flat(x: number, z: number): number {
    return this.bilinear8(this.data.flat, x, z);
  }

  /** Rockiness 0..1 (crests, cirque walls, faces). */
  rough(x: number, z: number): number {
    return this.bilinear8(this.data.rough, x, z);
  }

  /**
   * Curvature at the heightmap scale (1/m): negative on convex crests, positive in concave
   * valleys and hollows.
   */
  curvature(x: number, z: number): number {
    const s = this.spacing * 2;
    const c = this.sample(x, z);
    return (
      (this.sample(x + s, z) +
        this.sample(x - s, z) +
        this.sample(x, z + s) +
        this.sample(x, z - s) -
        4 * c) /
      (s * s)
    );
  }
}
