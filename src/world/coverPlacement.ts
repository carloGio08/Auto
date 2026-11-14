import { hash2, Rng } from '../math/rng';
import { smoothstep } from '../math/util';
import type { Course } from '../terrain/course';
import { TerrainColorer, type PatchPalette } from '../terrain/splat';
import { biomes, BIOME_IDS, richnessRules } from '../data/biomes';
import {
  flowerPatches,
  roadPebbles,
  shrubGroups,
  undergrowth,
  type UndergrowthKind,
} from '../data/vegetation';
import { ECO_STRIDE, ecologyAt, insideMap } from './propPlacement';
import {
  cellColourStd,
  cellRelief,
  maxCount,
  minCount,
  minTypes,
  RICH_STRIDE,
  scoreCell,
} from './richness';

/** Floats per ground-cover record: kind, x, y, z, scale, rnd (0..1, sets the reach). */
export const COVER_STRIDE = 6;
/** Ecology grid spacing inside a tile (m). */
const EGRID = 8;

/** Ground cover of one tile and the richness of its cells. */
export interface CoverData {
  /** COVER_STRIDE records. */
  items: Float32Array;
  /** RICH_STRIDE records, one per richness cell (row-major inside the tile). */
  cells: Float32Array;
}

const KIND = (k: UndergrowthKind): number => undergrowth.findIndex((u) => u.kind === k);
const PEBBLE = KIND('pebble');
const IS_FLOWER = undergrowth.map((u) => u.layout === 'patch');

/** Per-biome prop tables: kind indices and densities, flower kinds of the biome. */
const TABLES = BIOME_IDS.map((id) => {
  const b = biomes[id];
  const kinds = b.props.map((p) => KIND(p.kind));
  return {
    kinds,
    density: b.props.map((p) => p.density),
    flowers: kinds.filter((k) => IS_FLOWER[k]),
    flowerDensity: b.props.reduce((a, p) => a + (IS_FLOWER[KIND(p.kind)] ? p.density : 0), 0),
  };
});

/** Smooth value noise in [0, 1] (bilinear hashes). */
function valueNoise(x: number, z: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const u = x - i;
  const v = z - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

let colourer: { palette: PatchPalette; course: Course; c: TerrainColorer } | null = null;
const colourerFor = (course: Course, palette: PatchPalette): TerrainColorer => {
  if (!colourer || colourer.palette !== palette || colourer.course !== course)
    colourer = { palette, course, c: new TerrainColorer(course.terrain, palette) };
  return colourer.c;
};

/**
 * Deterministic ground cover of one square tile (pure, runs in the terrain worker).
 *
 * 1. Candidates on a jittered grid (spacing from the preset density); each takes the biome
 *    of its ecology sample and draws a kind from that biome's prop set (data/biomes.ts):
 *    flowers in tight patches of one or two colours, shrubs and saplings in loose groups,
 *    grass clumps, stones and ferns scattered; pebbles on and beside the trails. Nothing in
 *    water, on very steep ground or (except pebbles) on a trail band.
 * 2. Richness pass per ~32 m cell: score = prop variety + density + ground colour variation +
 *    relief (world/richness.ts). Below the biome's minimum kinds or density, filler props
 *    from the same biome (missing kinds first) are added at free spots; above its maximum,
 *    the extra instances are dropped. The per-cell records are returned for the debug probe
 *    and the tests.
 */
export function placeCover(
  course: Course,
  tx: number,
  tz: number,
  size: number,
  density: number,
  palette: PatchPalette | null = null,
): CoverData {
  const terrain = course.terrain;
  const seed = course.def.seed & 0xffff;
  const x0 = tx * size;
  const z0 = tz * size;
  const gn = Math.round(size / EGRID) + 1;
  const S = ECO_STRIDE;
  const E = new Float32Array(gn * gn * S);
  const tmp = new Float32Array(S);
  for (let j = 0; j < gn; j++)
    for (let i = 0; i < gn; i++) {
      const x = x0 + i * EGRID;
      const z = z0 + j * EGRID;
      if (!insideMap(course, x, z)) {
        E[(j * gn + i) * S + 9] = 1;
        continue;
      }
      ecologyAt(course, x, z, tmp);
      E.set(tmp, (j * gn + i) * S);
    }
  const at = (x: number, z: number, k: number): number => {
    const fx = Math.max(0, Math.min(gn - 1.001, (x - x0) / EGRID));
    const fz = Math.max(0, Math.min(gn - 1.001, (z - z0) / EGRID));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const o = (j * gn + i) * S + k;
    const a0 = E[o] + (E[o + S] - E[o]) * u;
    const a1 = E[o + gn * S] + (E[o + gn * S + S] - E[o + gn * S]) * u;
    return a0 + (a1 - a0) * v;
  };
  /** Biome of the nearest ecology sample (categorical: not interpolated). */
  const biomeAt = (x: number, z: number): number => {
    const i = Math.max(0, Math.min(gn - 1, Math.round((x - x0) / EGRID)));
    const j = Math.max(0, Math.min(gn - 1, Math.round((z - z0) / EGRID)));
    return E[(j * gn + i) * S + 10];
  };
  /** Exact distance beyond the worn band of the nearest trail (the grid is too coarse). */
  const edgeAt = (x: number, z: number): { edge: number; h: number } => {
    const h = terrain.height(x, z);
    const q = terrain.lastQuery;
    return { edge: q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : 1e4, h };
  };
  const free = (x: number, z: number): boolean =>
    insideMap(course, x, z) && at(x, z, 9) < 0.01 && at(x, z, 4) < 0.95;
  const mult = course.def.props.bushes;
  const step = 0.95 / Math.sqrt(Math.max(0.3, density));
  const cellA = step * step;
  // Records per richness cell (so the pass can count, fill and trim them).
  const C = richnessRules.cellSize;
  const nc = Math.max(1, Math.round(size / C));
  const cs = size / nc;
  const per: number[][] = Array.from({ length: nc * nc }, () => []);
  const cellOf = (x: number, z: number): number =>
    Math.min(nc - 1, Math.floor((z - z0) / cs)) * nc + Math.min(nc - 1, Math.floor((x - x0) / cs));
  const push = (kind: number, x: number, h: number, z: number, s: number, rnd: number): void => {
    const u = undergrowth[kind];
    const sz = u.size[0] + (u.size[1] - u.size[0]) * s;
    per[cellOf(x, z)].push(kind, x, h - 0.03, z, sz, rnd);
  };
  const flowerKind = (x: number, z: number, b: number, s: number): number => {
    const fl = TABLES[b].flowers;
    const cx = Math.floor(x / flowerPatches.colourCell);
    const cz = Math.floor(z / flowerPatches.colourCell);
    const main = fl[Math.floor(hash2(cx, cz, seed + 43) * fl.length)];
    const alt = fl[Math.floor(hash2(cx, cz, seed + 47) * fl.length)];
    return s < 0.75 ? main : alt;
  };

  // --- 1. Candidates ---------------------------------------------------------------------
  const rng = new Rng((tx * 73856093) ^ (tz * 19349663) ^ seed ^ 0xc0e7);
  for (let gz = 0; gz < size; gz += step)
    for (let gx = 0; gx < size; gx += step) {
      const x = x0 + gx + rng.next() * step;
      const z = z0 + gz + rng.next() * step;
      const roll = rng.next();
      const s = rng.next();
      const rnd = rng.next();
      if (!free(x, z)) continue;
      let roadEdge = at(x, z, 5);
      let h = NaN;
      if (roadEdge < 6) {
        const r = edgeAt(x, z);
        roadEdge = r.edge;
        h = r.h;
      }
      // Pebbles on and beside the trail.
      if (roadEdge < 2.5) {
        const p = roadEdge < 0 ? 0.6 : 1 - smoothstep(0.3, 2.5, roadEdge) * 0.7;
        if (roll < (roadPebbles * p * cellA) / 100) {
          push(PEBBLE, x, Number.isNaN(h) ? terrain.height(x, z) : h, z, s, rnd);
          continue;
        }
        if (roadEdge < 0.4) continue;
      }
      const b = biomeAt(x, z);
      const tab = TABLES[b];
      const patch = valueNoise(x / flowerPatches.scale, z / flowerPatches.scale, seed + 41);
      const inPatch = Math.max(
        0,
        (patch - flowerPatches.threshold) / (1 - flowerPatches.threshold),
      );
      const grp = valueNoise(x / shrubGroups.scale, z / shrubGroups.scale, seed + 53);
      const inGroup = Math.max(0, (grp - shrubGroups.threshold) / (1 - shrubGroups.threshold));
      let acc = 0;
      let kind = -1;
      // Flowers first (inside their patches), then the rest of the biome's set.
      if (tab.flowers.length) {
        acc += Math.min(0.9, (tab.flowerDensity * 3 * inPatch * mult * cellA) / 100);
        if (roll < acc) kind = flowerKind(x, z, b, s);
      }
      for (let k = 0; k < tab.kinds.length && kind < 0; k++) {
        const ki = tab.kinds[k];
        if (IS_FLOWER[ki]) continue;
        const lay = undergrowth[ki].layout;
        const d = tab.density[k] * (lay === 'group' ? 2.6 * inGroup : 1);
        acc += Math.min(0.9, (d * mult * cellA) / 100);
        if (roll < acc) kind = ki;
      }
      if (kind < 0) continue;
      push(kind, x, Number.isNaN(h) ? terrain.height(x, z) : h, z, s, rnd);
    }

  // --- 2. Richness pass: score, filler, cap ------------------------------------------------
  const cells = new Float32Array(nc * nc * RICH_STRIDE);
  const area = cs * cs;
  const colorer = palette ? colourerFor(course, palette) : null;
  const out: number[] = [];
  const seen = new Uint8Array(undergrowth.length);
  for (let c = 0; c < nc * nc; c++) {
    const cx0 = x0 + (c % nc) * cs;
    const cz0 = z0 + Math.floor(c / nc) * cs;
    const list = per[c];
    const b = biomeAt(cx0 + cs / 2, cz0 + cs / 2);
    const def = biomes[BIOME_IDS[b]];
    const tab = TABLES[b];
    const water = at(cx0 + cs / 2, cz0 + cs / 2, 9) > 0.5;
    seen.fill(0);
    let count = 0;
    let types = 0;
    for (let k = 0; k < list.length; k += COVER_STRIDE) {
      if (list[k] === PEBBLE) continue;
      count++;
      if (!seen[list[k]]) {
        seen[list[k]] = 1;
        types++;
      }
    }
    // Filler: same biome only, missing kinds first, at free spots off the trail.
    let filler = 0;
    if (!water && tab.kinds.length) {
      const needT = minTypes(def);
      const needN = minCount(def, area, density);
      const fr = new Rng((Math.floor(cx0) * 92821) ^ (Math.floor(cz0) * 68917) ^ seed ^ 0xf111);
      const order = tab.kinds
        .map((k, i) => ({ k, d: tab.density[i] }))
        .sort((a, bb) => bb.d - a.d)
        .map((e) => e.k);
      let tries = 0;
      while ((types < needT || count < needN) && tries++ < 400) {
        const x = cx0 + fr.next() * cs;
        const z = cz0 + fr.next() * cs;
        const s = fr.next();
        const rnd = fr.next();
        if (!free(x, z)) continue;
        const r = edgeAt(x, z);
        if (r.edge < 1) continue;
        let kind = -1;
        if (types < needT) kind = order.find((k) => !seen[k]) ?? -1;
        if (kind < 0) {
          // Weighted by the biome densities.
          let total = 0;
          for (const d of tab.density) total += d;
          let pick = fr.next() * total;
          for (let i = 0; i < tab.kinds.length; i++)
            if ((pick -= tab.density[i]) <= 0) {
              kind = tab.kinds[i];
              break;
            }
          if (kind < 0) kind = tab.kinds[0];
        }
        if (IS_FLOWER[kind]) kind = flowerKind(x, z, b, s);
        // push() files it into the cell of (x, z), which is this one.
        push(kind, x, r.h, z, s, rnd);
        count++;
        filler++;
        if (!seen[kind]) {
          seen[kind] = 1;
          types++;
        }
      }
    }
    // Cap: drop the extra instances with the largest rnd (least important, fade first).
    const cap = maxCount(def, area, density);
    if (count > cap) {
      const idx: number[] = [];
      for (let k = 0; k < list.length; k += COVER_STRIDE) if (list[k] !== PEBBLE) idx.push(k);
      idx.sort((a, bb) => list[bb + 5] - list[a + 5]);
      const drop = new Set(idx.slice(0, count - cap));
      for (let k = 0; k < list.length; k += COVER_STRIDE)
        if (!drop.has(k)) for (let f = 0; f < COVER_STRIDE; f++) out.push(list[k + f]);
      count = cap;
    } else for (const v of list) out.push(v);
    // Score (colour needs the palette: without it the colour component counts as met).
    const relief = cellRelief(course, cx0, cz0, cs);
    const colour = colorer
      ? cellColourStd(course, colorer, cx0, cz0, cs)
      : richnessRules.colourStd[0];
    scoreCell(b, count, types, colour, relief, area, density, filler, cells, c * RICH_STRIDE);
    // Water and off-map cells are not scored (no ground to cover).
    if (water) cells[c * RICH_STRIDE + 1] = -1;
  }
  return { items: Float32Array.from(out), cells };
}
