import { hash2, Rng } from '../math/rng';
import { smoothstep } from '../math/util';
import type { Course } from '../terrain/course';
import { flowerPatches, undergrowth } from '../data/vegetation';
import { ECO_STRIDE, ecologyAt, insideMap } from './propPlacement';

/** Floats per ground-cover record: kind, x, y, z, scale, rnd (0..1, sets the reach). */
export const COVER_STRIDE = 6;
/** Ecology grid spacing inside a tile (m). */
const EGRID = 8;

const FLOWERS = ['flowerY', 'flowerR', 'flowerP', 'flowerW'].map((k) =>
  undergrowth.findIndex((u) => u.kind === k),
);
const KIND = (k: string): number => undergrowth.findIndex((u) => u.kind === k);
const GRASS = KIND('grass');
const PEBBLE = KIND('pebble');

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

/**
 * Deterministic ground cover of one square tile (pure, runs in the terrain worker): grass
 * tufts on grassland, flowers in tight clustered patches of one or two colours, bushes at
 * forest edges, ferns, fallen logs and stumps on the forest floor, pebbles scattered on and
 * beside the trails. Candidates on a jittered grid whose spacing follows the preset density;
 * nothing in water, on very steep ground, or (except pebbles) on a trail band.
 */
export function placeCover(
  course: Course,
  tx: number,
  tz: number,
  size: number,
  density: number,
): Float32Array {
  const terrain = course.terrain;
  const seed = course.def.seed & 0xffff;
  const x0 = tx * size;
  const z0 = tz * size;
  const gn = Math.round(size / EGRID) + 1;
  const E = new Float32Array(gn * gn * ECO_STRIDE);
  const tmp = new Float32Array(ECO_STRIDE);
  for (let j = 0; j < gn; j++)
    for (let i = 0; i < gn; i++) {
      const x = x0 + i * EGRID;
      const z = z0 + j * EGRID;
      if (!insideMap(course, x, z)) {
        E[(j * gn + i) * ECO_STRIDE + 9] = 1;
        continue;
      }
      ecologyAt(course, x, z, tmp);
      E.set(tmp, (j * gn + i) * ECO_STRIDE);
    }
  const at = (x: number, z: number, k: number): number => {
    const fx = Math.max(0, Math.min(gn - 1.001, (x - x0) / EGRID));
    const fz = Math.max(0, Math.min(gn - 1.001, (z - z0) / EGRID));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const o = (j * gn + i) * ECO_STRIDE + k;
    const S = ECO_STRIDE;
    const a0 = E[o] + (E[o + S] - E[o]) * u;
    const a1 = E[o + gn * S] + (E[o + gn * S + S] - E[o + gn * S]) * u;
    return a0 + (a1 - a0) * v;
  };
  const props = course.def.props;
  const green0 = (x: number, z: number): number =>
    Math.min(1, at(x, z, 8) + at(x, z, 7) + at(x, z, 6) * 0.6);
  const step = 0.95 / Math.sqrt(Math.max(0.3, density));
  const cell = step * step;
  const out: number[] = [];
  const rng = new Rng((tx * 73856093) ^ (tz * 19349663) ^ seed ^ 0xc0e7);
  for (let gz = 0; gz < size; gz += step)
    for (let gx = 0; gx < size; gx += step) {
      const x = x0 + gx + rng.next() * step;
      const z = z0 + gz + rng.next() * step;
      const roll = rng.next();
      const s = rng.next();
      const rnd = rng.next();
      if (at(x, z, 9) > 0.01 || at(x, z, 4) > 0.9) continue;
      // Exact distance to the worn band near the trails (the 8 m grid is too coarse there).
      let roadEdge = at(x, z, 5);
      let h = NaN;
      if (roadEdge < 6) {
        h = terrain.height(x, z);
        const q = terrain.lastQuery;
        roadEdge = q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : 1e4;
      }
      const treeD = at(x, z, 0);
      let kind = -1;
      // Pebbles on and beside the trail.
      if (roadEdge < 2.5) {
        const p = roadEdge < 0 ? 0.6 : 1 - smoothstep(0.3, 2.5, roadEdge) * 0.7;
        if (roll < (undergrowth[PEBBLE].density * p * cell) / 100) kind = PEBBLE;
        else if (roadEdge < 0.4) continue;
      }
      if (kind < 0) {
        const forest = at(x, z, 6) * (0.3 + treeD);
        // Any vegetated ground (meadow, grassland, the floor of open woods) grows grass and
        // flowers; they thin out under dense trees.
        const green = Math.min(1, at(x, z, 8) + at(x, z, 7) + at(x, z, 6) * 0.6);
        const meadow = green * (1 - treeD * 0.85);
        const grass = green * (1 - treeD * 0.6);
        const edge = treeD * (1 - treeD) * 4;
        // Flower patches: tight clusters, one or two colours each.
        const patch = valueNoise(x / flowerPatches.scale, z / flowerPatches.scale, seed + 41);
        const inPatch = Math.max(
          0,
          (patch - flowerPatches.threshold) / (1 - flowerPatches.threshold),
        );
        let acc = 0;
        for (let k = 0; k < undergrowth.length && kind < 0; k++) {
          const u = undergrowth[k];
          if (u.habitat === 'road') continue;
          const isFlower = FLOWERS.includes(k);
          if (isFlower && k !== FLOWERS[0]) continue;
          const hab =
            u.habitat === 'forest'
              ? forest
              : u.habitat === 'meadow'
                ? meadow * inPatch
                : u.habitat === 'grass'
                  ? grass
                  : edge * 0.6 + forest * 0.2;
          acc += Math.min(0.9, (u.density * hab * props.bushes * cell) / 100);
          if (roll < acc) {
            if (isFlower) {
              // Colour of the patch (sometimes a second one mixed in).
              const cx = Math.floor(x / flowerPatches.colourCell);
              const cz = Math.floor(z / flowerPatches.colourCell);
              const main = Math.floor(hash2(cx, cz, seed + 43) * 4);
              const alt = Math.floor(hash2(cx, cz, seed + 47) * 4);
              kind = FLOWERS[s < 0.75 ? main : alt];
            } else kind = k;
          }
        }
        if (kind < 0) continue;
      }
      const u = undergrowth[kind];
      const sz = u.size[0] + (u.size[1] - u.size[0]) * s;
      // No stray tufts on bare ground.
      if (kind === GRASS && green0(x, z) < 0.15) continue;
      out.push(kind, x, (Number.isNaN(h) ? terrain.height(x, z) : h) - 0.03, z, sz, rnd);
    }
  return Float32Array.from(out);
}
