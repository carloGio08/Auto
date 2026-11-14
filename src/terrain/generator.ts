import type { MountainDef } from '../data/types';
import { blur, flowGraph, limitSlope, smoothFloors, streamPower, thermalErosion } from './erosion';
import type { HeightfieldData } from './heightfield';
import { LandformField } from './landforms';
import { applyRelief, dropletErosion } from './relief';

/** Heightmap spacing (m): coarse enough for phones, detail is added analytically. */
export const HEIGHTMAP_SPACING = 12;
/** Half extent covered by the heightmap (m): the playable map, the rim and LOD margins. */
export const heightmapHalfExtent = (def: MountainDef): number => def.halfSize * 1.33;

/** Traced stream (world XZ polyline from the spring down to the lake). */
export interface StreamPath {
  x: Float32Array;
  z: Float32Array;
}

/** Everything the generation worker hands back: transferable typed arrays only. */
export interface TerrainData {
  field: HeightfieldData;
  streams: StreamPath[];
}

/**
 * Generation pipeline (pure, deterministic from the definition):
 * landforms → heightmap → intermediate relief → talus + thermal erosion → flow routing →
 * stream incision → gullies → droplet erosion → floor smoothing → talus + thermal erosion →
 * moisture and stream tracing. Runs in a Web Worker in the browser
 * (see terrainWorker.ts) and synchronously in tests.
 */
export function generateTerrain(def: MountainDef, progress?: (p: number) => void): TerrainData {
  const spacing = HEIGHTMAP_SPACING;
  const half = heightmapHalfExtent(def);
  // Odd sample count (even number of cells) so the coarse design grid lines up.
  const n = Math.ceil(half / spacing) * 2 + 1;
  const min = -((n - 1) * spacing) / 2;
  const N = n * n;
  const h = new Float32Array(N);
  const roughF = new Float32Array(N);
  const flatF = new Float32Array(N);
  // The designed shape only has features of 60 m and more: evaluate it on a grid twice as
  // coarse and upsample (Catmull-Rom), four times fewer landform evaluations.
  const field = new LandformField(def);
  const nc = (n - 1) / 2 + 1;
  const hc = new Float32Array(nc * nc);
  const rc = new Float32Array(nc * nc);
  const fc = new Float32Array(nc * nc);
  for (let j = 0; j < nc; j++) {
    const z = min + j * spacing * 2;
    for (let i = 0; i < nc; i++) {
      hc[j * nc + i] = field.height(min + i * spacing * 2, z);
      rc[j * nc + i] = field.rough;
      fc[j * nc + i] = field.flat;
    }
    if (progress && (j & 15) === 0) progress((j / nc) * 0.5);
  }
  upsample2(hc, nc, h, n);
  upsample2(rc, nc, roughF, n);
  upsample2(fc, nc, flatF, n);
  for (let c = 0; c < N; c++) {
    roughF[c] = Math.max(0, Math.min(1, roughF[c]));
    flatF[c] = Math.max(0, Math.min(1, flatF[c]));
  }
  // Intermediate relief by zone: spurs, terraces, hummocks (nothing on declared flats).
  applyRelief(h, flatF, roughF, n, spacing, min, def.relief, def.seed);
  progress?.(0.55);
  const er = def.erosion;
  // Talus: walls are cut back to the repose angle; rugged cells (crags, cirque walls) may
  // stay steeper.
  const talusLimit = (c: number): number => er.talus + 0.4 * roughF[c] * roughF[c];
  limitSlope(h, n, spacing, talusLimit);
  thermalErosion(h, n, spacing, er.talus, Math.ceil(er.thermalIterations / 2));
  progress?.(0.62);
  // Outlets: the lake (and the border, implicitly).
  const outlet = new Uint8Array(N);
  const lk = def.lake;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = min + i * spacing;
      const z = min + j * spacing;
      if (Math.hypot(x - lk.x, (z - lk.z) * 1.15) < lk.radius * 0.7) outlet[j * n + i] = 1;
    }
  let graph = flowGraph(h, n, outlet);
  for (let p = 0; p < er.hydraulicPasses; p++) {
    streamPower(h, n, spacing, graph, er.hydraulicStrength);
    if (p < er.hydraulicPasses - 1) graph = flowGraph(h, n, outlet);
  }
  // Gullies where flow gathers on slopes (not on the declared flats).
  carveGullies(h, n, spacing, graph.area, flatF, def.relief.gullies.depth);
  progress?.(0.72);
  // Particle erosion: rills, small fans; then the debris settles (thermal below).
  const km2 = ((n - 1) * spacing) ** 2 / 1e6;
  dropletErosion(h, n, spacing, Math.round(er.droplets * km2), er.dropletStrength, def.seed);
  progress?.(0.8);
  smoothFloors(h, n, graph.area, er.floorSmoothing, 40, 4000);
  smoothFloors(h, n, graph.area, er.floorSmoothing, 40, 4000);
  limitSlope(h, n, spacing, talusLimit, 2);
  thermalErosion(h, n, spacing, er.talus, Math.floor(er.thermalIterations / 2));
  progress?.(0.9);
  graph = flowGraph(h, n, outlet);
  // Moisture: log of the upstream area, spread a little sideways.
  const moistF = new Float32Array(N);
  const lo = Math.log(6);
  const hi = Math.log(6000);
  for (let c = 0; c < N; c++)
    moistF[c] = Math.max(0, Math.min(1, (Math.log(graph.area[c]) - lo) / (hi - lo)));
  blur(moistF, n, 2);
  blur(roughF, n, 1);
  const moisture = new Uint8Array(N);
  const rough = new Uint8Array(N);
  const flat = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    moisture[c] = Math.round(Math.min(1, moistF[c] * 1.6) * 255);
    rough[c] = Math.round(Math.min(1, roughF[c]) * 255);
    flat[c] = Math.round(flatF[c] * 255);
  }
  const streams = traceStreams(def, n, spacing, min, graph.receiver, outlet, h);
  progress?.(1);
  return { field: { n, spacing, min, height: h, moisture, rough, flat }, streams };
}

/** Follows the flow graph from each spring down to the lake, then smooths the polyline. */
function traceStreams(
  def: MountainDef,
  n: number,
  spacing: number,
  min: number,
  receiver: Int32Array,
  outlet: Uint8Array,
  h: Float32Array,
): StreamPath[] {
  const slopeAt = (x: number, z: number): number => {
    const i = Math.max(1, Math.min(n - 2, Math.round((x - min) / spacing)));
    const j = Math.max(1, Math.min(n - 2, Math.round((z - min) / spacing)));
    const c = j * n + i;
    return Math.hypot(h[c + 1] - h[c - 1], h[c + n] - h[c - n]) / (2 * spacing);
  };
  const out: StreamPath[] = [];
  for (const r of def.rivers) {
    const i0 = Math.round((r.spring[0] - min) / spacing);
    const j0 = Math.round((r.spring[1] - min) / spacing);
    let c = Math.max(0, Math.min(n - 1, j0)) * n + Math.max(0, Math.min(n - 1, i0));
    let pts: [number, number][] = [];
    for (let guard = 0; guard < n * 4 && c >= 0; guard++) {
      pts.push([min + (c % n) * spacing, min + Math.floor(c / n) * spacing]);
      if (outlet[c]) break;
      c = receiver[c];
    }
    if (pts.length < 6) {
      // Keep the index aligned with def.rivers (an empty path is skipped later).
      out.push({ x: new Float32Array(0), z: new Float32Array(0) });
      continue;
    }
    // Thin out the staircase, then round it into a meandering curve.
    pts = pts.filter((_, k) => k % 3 === 0 || k === pts.length - 1);
    for (let it = 0; it < 3; it++) {
      const o: [number, number][] = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, z0] = pts[k];
        const [x1, z1] = pts[k + 1];
        o.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25]);
        o.push([x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
      }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    // Resample about every 20 m.
    const xs: number[] = [pts[0][0]];
    const zs: number[] = [pts[0][1]];
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      if (acc >= 20 || k === pts.length - 1) {
        xs.push(pts[k][0]);
        zs.push(pts[k][1]);
        acc = 0;
      }
    }
    // Meanders where the valley floor is flat (flow routing alone draws straight lines there).
    const m = xs.length;
    const ox = xs.slice();
    const oz = zs.slice();
    let s = 0;
    for (let k = 1; k < m - 1; k++) {
      const tx = xs[k + 1] - xs[k - 1];
      const tz = zs[k + 1] - zs[k - 1];
      const tl = Math.hypot(tx, tz) || 1;
      s += Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
      const flat = 1 - Math.min(1, slopeAt(xs[k], zs[k]) / 0.08);
      const ends = Math.min(1, k / 6, (m - 1 - k) / 6);
      const off =
        26 * flat * ends * Math.sin(s / 95 + r.spring[0] * 0.01) * Math.sin(s / 410 + 1.3);
      ox[k] = xs[k] + (tz / tl) * off;
      oz[k] = zs[k] - (tx / tl) * off;
    }
    out.push({ x: Float32Array.from(ox), z: Float32Array.from(oz) });
  }
  return out;
}

/** Catmull-Rom upsampling of a coarse grid (nc × nc) to a fine grid (n = 2·nc − 1). */
function upsample2(src: Float32Array, nc: number, dst: Float32Array, n: number): void {
  const cr = (a: number, b: number, c: number, d: number): number => (-a + 9 * b + 9 * c - d) / 16;
  const at = (i: number, j: number): number =>
    src[Math.max(0, Math.min(nc - 1, j)) * nc + Math.max(0, Math.min(nc - 1, i))];
  for (let j = 0; j < nc; j++) {
    for (let i = 0; i < nc; i++) {
      dst[2 * j * n + 2 * i] = src[j * nc + i];
      if (i < nc - 1)
        dst[2 * j * n + 2 * i + 1] = cr(at(i - 1, j), at(i, j), at(i + 1, j), at(i + 2, j));
    }
  }
  for (let j = 0; j < nc - 1; j++) {
    const fj = 2 * j + 1;
    for (let i = 0; i < n; i++) {
      const v = (jj: number): number => dst[Math.max(0, Math.min(nc - 1, jj)) * 2 * n + i];
      dst[fj * n + i] = cr(v(j - 1), v(j), v(j + 1), v(j + 2));
    }
  }
}

/** Cuts gullies along the flow lines of slopes: depth grows with the upstream area. */
function carveGullies(
  h: Float32Array,
  n: number,
  spacing: number,
  area: Float32Array,
  flat: Float32Array,
  depth: number,
): void {
  if (depth <= 0) return;
  const lo = Math.log(6);
  const hi = Math.log(400);
  const src = h.slice();
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      const a = Math.log(area[c]);
      if (a <= lo) continue;
      const slope = Math.hypot(src[c + 1] - src[c - 1], src[c + n] - src[c - n]) / (2 * spacing);
      const onSlope = Math.min(1, Math.max(0, (slope - 0.12) / 0.25));
      const k = Math.min(1, (a - lo) / (hi - lo)) * onSlope * (1 - flat[c]);
      // Neighbours get half of it: a V with a rounded floor.
      h[c] -= depth * k;
      h[c - 1] -= depth * k * 0.25;
      h[c + 1] -= depth * k * 0.25;
      h[c - n] -= depth * k * 0.25;
      h[c + n] -= depth * k * 0.25;
    }
}
