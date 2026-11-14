import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import type { ReliefDef } from '../data/types';

/**
 * Intermediate-scale relief (tens to hundreds of metres) added to the designed heightmap,
 * shaped by zone so no slope stays a smooth uniform sheet:
 * - spurs and small crests (ridged multifractal, domain-warped) on slopes, stronger on
 *   rugged ground;
 * - smoothed terrace steps on slopes, in patches;
 * - rolling hummocks and hollows on gentle ground (natural ramps), almost none on the
 *   declared flats (meadows, terraces, valley floors).
 * Works in place on the grid; gullies come later from the flow accumulation.
 */
export function applyRelief(
  h: Float32Array,
  flat: Float32Array,
  rough: Float32Array,
  n: number,
  spacing: number,
  min: number,
  r: ReliefDef,
  seed: number,
): void {
  const warp = new Simplex2(seed ^ 0x1e1f);
  const ridge = new Simplex2(seed ^ 0x2e2f);
  const hum = new Simplex2(seed ^ 0x3e3f);
  const zone = new Simplex2(seed ^ 0x4e4f);
  const src = h.slice();
  const ws = 1 / r.warp.scale;
  const ss = 1 / r.spurs.scale;
  const hs = 1 / r.hummocks.scale;
  const ts = 1 / r.terraces.scale;
  const step = r.terraces.step;
  for (let j = 1; j < n - 1; j++) {
    const z = min + j * spacing;
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      const x = min + i * spacing;
      const sx = (src[c + 1] - src[c - 1]) / (2 * spacing);
      const sz = (src[c + n] - src[c - n]) / (2 * spacing);
      const slope = Math.hypot(sx, sz);
      const f = flat[c];
      const open = 1 - f;
      const sloped = smoothstep(0.1, 0.32, slope) * (1 - smoothstep(0.95, 1.3, slope));
      const gentle = 1 - smoothstep(0.12, 0.3, slope);
      const wx = x + r.warp.amplitude * warp.noise(x * ws, z * ws);
      const wz = z + r.warp.amplitude * warp.noise(x * ws + 17.1, z * ws - 3.7);
      let d = 0;
      // Spurs: sharp ridged crests, softened, centred on zero.
      const sp = ridge.ridged(wx * ss, wz * ss, 3);
      d += r.spurs.amplitude * (sp - 0.42) * sloped * (0.55 + 0.45 * rough[c]) * open;
      // Hummocks: rolling, low amplitude, mostly on gentle ground.
      const hm = hum.fbm(wx * hs, wz * hs, 2);
      d += r.hummocks.amplitude * hm * (0.35 + 0.65 * gentle) * (1 - 0.85 * f);
      // Terraces: smoothed steps where the zone noise says so.
      const tz = smoothstep(0.05, 0.4, zone.fbm(x * ts, z * ts, 2));
      if (tz > 0 && step > 0) {
        const hv = src[c] + d;
        const t = hv / step;
        const k = Math.floor(t);
        const u = t - k;
        const stepped = (k + smoothstep(0.3, 0.7, u)) * step;
        d += (stepped - hv) * r.terraces.amount * tz * sloped * open * (1 - rough[c]);
      }
      h[c] = src[c] + d;
    }
  }
}

/**
 * Deterministic particle (droplet) hydraulic erosion on the heightmap: each droplet runs
 * downhill with a little inertia, picks up sediment where it speeds up and drops it where
 * it slows, carving rills and gullies and leaving small fans. Bilinear deposit/erode on the
 * four cells around the droplet. Coarse (12 m) and budgeted by the droplet count.
 */
export function dropletErosion(
  h: Float32Array,
  n: number,
  spacing: number,
  count: number,
  strength: number,
  seed: number,
): void {
  if (count <= 0 || strength <= 0) return;
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inertia = 0.1;
  const capacityK = 4 * strength;
  const erodeK = 0.25 * strength;
  const depositK = 0.3;
  const evaporate = 0.03;
  const maxSteps = 48;
  const grad = (px: number, pz: number, out: Float64Array): void => {
    const i = Math.floor(px);
    const j = Math.floor(pz);
    const u = px - i;
    const v = pz - j;
    const c = j * n + i;
    const h00 = h[c];
    const h10 = h[c + 1];
    const h01 = h[c + n];
    const h11 = h[c + n + 1];
    out[0] = (h10 - h00) * (1 - v) + (h11 - h01) * v;
    out[1] = (h01 - h00) * (1 - u) + (h11 - h10) * u;
    out[2] = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  };
  const add = (px: number, pz: number, amount: number): void => {
    const i = Math.floor(px);
    const j = Math.floor(pz);
    const u = px - i;
    const v = pz - j;
    const c = j * n + i;
    h[c] += amount * (1 - u) * (1 - v);
    h[c + 1] += amount * u * (1 - v);
    h[c + n] += amount * (1 - u) * v;
    h[c + n + 1] += amount * u * v;
  };
  const g = new Float64Array(3);
  const g2 = new Float64Array(3);
  for (let d = 0; d < count; d++) {
    let px = 2 + rnd() * (n - 5);
    let pz = 2 + rnd() * (n - 5);
    let dx = 0;
    let dz = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let it = 0; it < maxSteps; it++) {
      grad(px, pz, g);
      dx = dx * inertia - g[0] * (1 - inertia);
      dz = dz * inertia - g[1] * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) break;
      dx /= len;
      dz /= len;
      const nx = px + dx;
      const nz = pz + dz;
      if (nx < 1 || nz < 1 || nx >= n - 2 || nz >= n - 2) break;
      grad(nx, nz, g2);
      const dh = g2[2] - g[2];
      const capacity = Math.max(-dh, 0.01) * speed * water * capacityK;
      if (sediment > capacity || dh > 0) {
        // Deposit (fill the pit when going uphill).
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositK;
        sediment -= amount;
        add(px, pz, amount);
      } else {
        // Erode, never deeper than the drop to the next point.
        const amount = Math.min((capacity - sediment) * erodeK, -dh);
        sediment += amount;
        add(px, pz, -amount);
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * -0.6 * (spacing / 12)));
      water *= 1 - evaporate;
      px = nx;
      pz = nz;
    }
  }
}
