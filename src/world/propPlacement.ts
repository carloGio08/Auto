import { hash2, Rng } from '../math/rng';
import { smoothstep } from '../math/util';
import type { Course } from '../terrain/course';
import { Mat } from '../terrain/biome';
import { ecology, MIN_TREE_HEIGHT, treeSpecies } from '../data/vegetation';
import { biomes, BIOME_IDS, type BiomeId } from '../data/biomes';

/** Rock prop types (instanced per cell). */
export const ROCK_TYPES = [
  'rock0',
  'rock1',
  'rock2',
  'rockSlab',
  'rockSpire',
  'rockRound',
  'boulder0',
  'boulder1',
] as const;
export type RockType = (typeof ROCK_TYPES)[number];

/** Why a rock is where it is (tests, debug overlay). */
export type RockReason = 'outcrop' | 'talus' | 'streambed' | 'trailside' | 'erratic' | 'boulders';
const REASONS: RockReason[] = ['outcrop', 'talus', 'streambed', 'trailside', 'erratic', 'boulders'];

/** Tree ages; they are also the destructible tiers (data/trees.ts). */
export const TREE_AGES = ['young', 'medium', 'old'] as const;

/** Floats per record in the cell arrays. */
export const TREE_STRIDE = 8; // species, age, x, y, z, height, width, rot
export const ROCK_STRIDE = 7; // type, x, y, z, scale, rot, collides
export const BLOB_STRIDE = 7; // x, y, z, radius, height, tone, trees

/**
 * Props of one square cell, as transferable typed arrays (built in the terrain worker, or on
 * the main thread as a fallback). `full` cells have trees, rocks and undergrowth; far cells
 * only the canopy masses.
 */
export interface CellData {
  cx: number;
  cz: number;
  full: boolean;
  trees: Float32Array;
  rocks: Float32Array;
  rockReasons: Uint8Array;
  /** Canopy masses for the far LOD, from the same forest density. */
  blobs: Float32Array;
}

const weights = new Float32Array(Mat.Count);
/** Density grid spacing (m) for full cells and far cells. */
const GRID = 8;
const FAR_GRID = 16;

/** Species weights at a normalised altitude and wetness (into `out`); returns the sum. */
function speciesWeights(alt01: number, wet: number, out: Float32Array): number {
  let sum = 0;
  treeSpecies.forEach((s, i) => {
    const band =
      smoothstep(s.zone[0] - 0.12, s.zone[0] + 0.08, alt01) *
      (1 - smoothstep(s.zone[1] - 0.08, s.zone[1] + 0.12, alt01));
    const m =
      smoothstep(s.moisture[0] - 0.2, s.moisture[0] + 0.1, wet) *
      (1 - smoothstep(s.moisture[1] - 0.1, s.moisture[1] + 0.2, wet));
    out[i] = s.weight * band * (0.25 + 0.75 * m);
    sum += out[i];
  });
  return sum;
}
const sw = new Float32Array(treeSpecies.length);

/** Floats per ecology sample (see ecologyAt). */
export const ECO_STRIDE = 12;

/** Whether a point is inside the playable map (with a small margin). */
export const insideMap = (course: Course, x: number, z: number): boolean =>
  Math.max(Math.abs(x), Math.abs(z)) <= course.def.halfSize * 1.05;

/**
 * Ecology of one point, into `out` (ECO_STRIDE floats): 0 tree density (forest from the
 * biome model raised to the clumping exponent, modulated by the low-frequency cluster
 * noise, thinning to the tree line, lone meadow trees), 1 ground height, 2 altitude 0..1
 * (valley line → tree line), 3 wetness, 4 slope, 5 distance to the worn band of the nearest
 * trail, habitats 6 forest floor, 7 flowers, 8 grass, 9 water (1) or dry land (0).
 */
export function ecologyAt(course: Course, x: number, z: number, out: Float32Array): void {
  const terrain = course.terrain;
  const bio = terrain.biomes;
  const def = course.def;
  const b = def.biomes;
  const h = terrain.height(x, z);
  const q = terrain.lastQuery;
  const roadEdge = q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : 1e4;
  const hx = terrain.height(x + 2, z) - terrain.height(x - 2, z);
  const hz = terrain.height(x, z + 2) - terrain.height(x, z - 2);
  const slope = Math.hypot(hx, hz) / 4;
  const ny = 1 / Math.sqrt(1 + slope * slope);
  bio.weights({ x, z, h, ny, nz: -hz / 4 / Math.sqrt(1 + slope * slope), roadEdge }, weights);
  const a = h + bio.wobble(x, z);
  const alt01 = (a - b.valleyLine) / (b.treeLine - b.valleyLine);
  const dry = h < def.lake.level + 1.2 || terrain.waterLevel(x, z) > h - 0.3;
  // The biome forest density already carries the woods/glades cluster noise.
  let dens = dry || slope > ecology.maxSlope ? 0 : bio.forest;
  dens = Math.pow(dens, ecology.clumping);
  const cl = bio.clusterValue;
  dens *= 1 - (1 - ecology.treeLineDensity) * smoothstep(0.75, 1.05, alt01);
  // A few lone trees in open meadows.
  if (!dry && slope < ecology.maxSlope * 0.8 && alt01 < 0.95)
    dens = Math.max(dens, ecology.loneTrees * (weights[Mat.Grass] + weights[Mat.Flowers]));
  // Scattered larches just above the tree line.
  if (alt01 > 1 && alt01 < 1.2 && !dry && slope < ecology.maxSlope)
    dens = Math.max(dens, 0.12 * (1 - smoothstep(1.05, 1.2, alt01)) * smoothstep(-0.2, 0.3, cl));
  out[0] = Math.min(1, dens);
  out[1] = h;
  out[2] = alt01;
  out[3] = bio.moisture;
  out[4] = slope;
  out[5] = roadEdge;
  out[6] = weights[Mat.Forest] + weights[Mat.Undergrowth] + weights[Mat.Moss];
  out[7] = weights[Mat.Flowers];
  out[8] = weights[Mat.Grass] + weights[Mat.DryGrass] + weights[Mat.RockGrass] * 0.5;
  out[9] = dry ? 1 : 0;
  out[10] = classifyBiome(weights, out[0], alt01, slope);
  out[11] = bio.curvature;
}

const B = (id: BiomeId): number => BIOME_IDS.indexOf(id);
const SNOWFIELD = B('snowfield');
const ROCKBAND = B('rockBand');
const SCREE = B('scree');
const SHORE = B('shore');
const FOREST = B('forest');
const TREELINE = B('treeLine');
const EDGE = B('forestEdge');
const ALPINE = B('alpineMeadow');
const STEEP = B('steepMeadow');
const VALLEY = B('valleyMeadow');

/**
 * Biome of a point (index in BIOME_IDS) from its material weights, tree density, altitude
 * (0 valley line .. 1 tree line) and slope: snowfield, rock band, scree, shore, forest, tree
 * line, forest edge, then open meadows — alpine above the tree line, steep on slopes over
 * ~17°, valley meadows below.
 */
export function classifyBiome(w: Float32Array, tree: number, alt01: number, slope: number): number {
  if (w[Mat.Snow] + w[Mat.SnowShade] > 0.5) return SNOWFIELD;
  if (w[Mat.RockLight] + w[Mat.RockDark] + w[Mat.SnowRock] > 0.55) return ROCKBAND;
  if (w[Mat.Scree] > 0.4) return SCREE;
  if (w[Mat.Sand] > 0.3) return SHORE;
  if (tree > 0.35) return FOREST;
  if (Math.abs(alt01 - 1) < 0.1) return TREELINE;
  if (tree > 0.1) return EDGE;
  if (slope > 0.3) return STEEP;
  return alt01 > 1 ? ALPINE : VALLEY;
}

/**
 * Deterministic placement of one cell (pure: no three.js).
 *
 * - An ecological density grid (8 m): forest density from the biome model (altitude,
 *   slope, wetness, curvature, clearings) raised to a clumping exponent and modulated by a
 *   low-frequency cluster noise, so woods are compact with clear glades and soft edges; it
 *   thins out and shrinks towards the tree line.
 * - Trees on a global Poisson disk (a jittered grid where each candidate yields to any
 *   higher-priority candidate closer than the minimum distance): seamless across cells,
 *   accepted by the density. Species by altitude band and wetness, age (young near the
 *   trails and at the forest edge, old deep inside), realistic heights (6–25 m).
 * - Canopy masses (far LOD) from the same density, one per 32 m bucket.
 * - Rocks only where they make sense (outcrops, talus, stream beds, a few by the trails),
 *   and groups of big faceted boulders beside the trails and on slopes, never on the
 *   driving line. (Ground cover is placed per smaller tile: coverPlacement.ts.)
 * Never on a trail band, in water, or on slopes beyond ~40°.
 */
export function placeCell(
  course: Course,
  cx: number,
  cz: number,
  size: number,
  density: number,
  full = true,
): CellData {
  const terrain = course.terrain;
  const bio = terrain.biomes;
  const def = course.def;
  const x0 = cx * size;
  const z0 = cz * size;
  const step = full ? GRID : FAR_GRID;
  const gn = Math.round(size / step) + 1;
  // Per grid point: tree density, ground height, altitude 0..1, wetness, slope, road edge,
  // habitats (forest floor, meadow, grass, edge).
  const D = new Float32Array(gn * gn * ECO_STRIDE);
  const inMap = (x: number, z: number): boolean => insideMap(course, x, z);
  const tmp = new Float32Array(ECO_STRIDE);
  for (let j = 0; j < gn; j++)
    for (let i = 0; i < gn; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      if (!inMap(x, z)) continue;
      ecologyAt(course, x, z, tmp);
      D.set(tmp, (j * gn + i) * ECO_STRIDE);
    }
  const at = (x: number, z: number, k: number): number => {
    const fx = Math.max(0, Math.min(gn - 1.001, (x - x0) / step));
    const fz = Math.max(0, Math.min(gn - 1.001, (z - z0) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const S = ECO_STRIDE;
    const o = (j * gn + i) * S + k;
    const a0 = D[o] + (D[o + S] - D[o]) * u;
    const a1 = D[o + gn * S] + (D[o + gn * S + S] - D[o + gn * S]) * u;
    return a0 + (a1 - a0) * v;
  };
  const blocked = (x: number, z: number, clearance: number): boolean =>
    !inMap(x, z) ||
    at(x, z, 9) > 0.01 ||
    at(x, z, 5) < clearance ||
    Math.hypot(x - course.base.x, z - course.base.z) < course.base.radius + 25 ||
    Math.hypot(x - course.start.x, z - course.start.z) < 40;

  // --- Canopy masses: one per 32 m bucket from the density grid -------------------------
  const blobs: number[] = [];
  const B = 32;
  for (let bz = 0; bz < size; bz += B)
    for (let bx = 0; bx < size; bx += B) {
      let dsum = 0;
      let asum = 0;
      let ymin = Infinity;
      let nIn = 0;
      for (let sz = 4; sz < B; sz += 8)
        for (let sx = 4; sx < B; sx += 8) {
          const x = x0 + bx + sx;
          const z = z0 + bz + sz;
          if (blocked(x, z, 4)) continue;
          dsum += at(x, z, 0);
          asum += at(x, z, 2);
          ymin = Math.min(ymin, at(x, z, 1));
          nIn++;
        }
      if (nIn === 0) continue;
      const d = dsum / 16;
      if (d < 0.08) continue;
      const alt01 = asum / nIn;
      const hgt = 18 * (1 - (1 - ecology.treeLineHeight) * smoothstep(0.75, 1.05, alt01));
      const jx = (hash2(cx * 64 + bx, cz * 64 + bz, 17) - 0.5) * 10;
      const jz = (hash2(cx * 64 + bx, cz * 64 + bz, 19) - 0.5) * 10;
      const x = x0 + bx + B / 2 + jx;
      const z = z0 + bz + B / 2 + jz;
      blobs.push(
        x,
        terrain.height(x, z) - 1,
        z,
        B * 0.42 * Math.sqrt(Math.min(1, d * 1.6)) + 3,
        hgt * (0.75 + 0.25 * Math.min(1, d * 2)),
        Math.min(1, Math.max(0, alt01)),
        Math.round(d * 40),
      );
    }

  if (!full)
    return {
      cx,
      cz,
      full,
      trees: new Float32Array(0),
      rocks: new Float32Array(0),
      rockReasons: new Uint8Array(0),
      blobs: Float32Array.from(blobs),
    };

  // --- Trees: global Poisson disk, accepted by density ----------------------------------
  const trees: number[] = [];
  const r = ecology.minTreeDistance;
  const g = r / Math.SQRT2;
  const seed = def.seed & 0xffff;
  const cand = (gi: number, gj: number, out: Float64Array): void => {
    out[0] = (gi + hash2(gi, gj, seed + 1)) * g;
    out[1] = (gj + hash2(gi, gj, seed + 2)) * g;
    out[2] = hash2(gi, gj, seed + 3);
  };
  const c0 = new Float64Array(3);
  const c1 = new Float64Array(3);
  const gi0 = Math.floor(x0 / g);
  const gj0 = Math.floor(z0 / g);
  const gi1 = Math.floor((x0 + size) / g);
  const gj1 = Math.floor((z0 + size) / g);
  const reach = Math.ceil(r / g);
  const treeScale = def.props.trees * density;
  for (let gj = gj0; gj <= gj1; gj++)
    for (let gi = gi0; gi <= gi1; gi++) {
      cand(gi, gj, c0);
      const x = c0[0];
      const z = c0[1];
      if (x < x0 || z < z0 || x >= x0 + size || z >= z0 + size) continue;
      const dens = at(x, z, 0) * treeScale;
      const accept = hash2(gi, gj, seed + 4);
      if (accept >= dens * 0.9) continue;
      if (blocked(x, z, ecology.trailClearance)) continue;
      if (at(x, z, 4) > ecology.maxSlope) continue;
      // Exact slope at the trunk (the grid is coarse).
      const sx = terrain.height(x + 2, z) - terrain.height(x - 2, z);
      const sz = terrain.height(x, z + 2) - terrain.height(x, z - 2);
      if (Math.hypot(sx, sz) / 4 > ecology.maxSlope) continue;
      const ground = terrain.height(x, z);
      if (terrain.waterLevel(x, z) > ground - 0.5) continue;
      // Yield to any higher-priority candidate closer than r (Poisson disk).
      let ok = true;
      for (let dj = -reach; dj <= reach && ok; dj++)
        for (let di = -reach; di <= reach; di++) {
          if (!di && !dj) continue;
          cand(gi + di, gj + dj, c1);
          if (c1[2] > c0[2] && (c1[0] - x) ** 2 + (c1[1] - z) ** 2 < r * r) {
            ok = false;
            break;
          }
        }
      if (!ok) continue;
      const alt01 = at(x, z, 2);
      const total = speciesWeights(alt01, at(x, z, 3), sw);
      if (total <= 0) continue;
      let pick = hash2(gi, gj, seed + 5) * total;
      let sp = 0;
      while (sp < sw.length - 1 && (pick -= sw[sp]) > 0) sp++;
      // Age: young by the trails and at forest edges, old deep in the woods.
      const roadEdge = at(x, z, 5);
      const deep = smoothstep(8, 60, roadEdge) * smoothstep(0.15, 0.6, at(x, z, 0));
      const ageRoll = hash2(gi, gj, seed + 6) * 0.8 + deep * 0.35;
      const age = ageRoll < 0.38 ? 0 : ageRoll < 0.82 ? 1 : 2;
      const range = treeSpecies[sp].heights[TREE_AGES[age]];
      const lineK = 1 - (1 - ecology.treeLineHeight) * smoothstep(0.8, 1.05, alt01);
      const height = Math.max(
        MIN_TREE_HEIGHT,
        (range[0] + (range[1] - range[0]) * hash2(gi, gj, seed + 7)) * lineK,
      );
      const width = height * treeSpecies[sp].width * (0.85 + 0.3 * hash2(gi, gj, seed + 8));
      trees.push(
        sp,
        age,
        x,
        ground - 0.15,
        z,
        height,
        width,
        hash2(gi, gj, seed + 9) * Math.PI * 2,
      );
    }

  // --- Rocks: outcrops, talus, stream beds, trailside stones, rare erratics -------------
  const rocks: number[] = [];
  const reasons: number[] = [];
  const rr = new Rng((cx * 83492791) ^ (cz * 297121507) ^ def.seed);
  const mountain = course.mountain;
  const rs = 9;
  for (let gz = 0; gz < size; gz += rs)
    for (let gx = 0; gx < size; gx += rs) {
      const x = x0 + gx + rr.range(0, rs);
      const z = z0 + gz + rr.range(0, rs);
      const roll = rr.next();
      const kindRoll = rr.next();
      const rot = rr.range(0, Math.PI * 2);
      const s0 = rr.next();
      if (blocked(x, z, 1.2)) continue;
      const h = terrain.height(x, z);
      const q = terrain.lastQuery;
      const roadEdge = q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : 1e4;
      const hx = terrain.height(x + 1.5, z);
      const hz = terrain.height(x, z + 1.5);
      const slope = Math.hypot(hx - h, hz - h) / 1.5;
      const ny = 1 / Math.sqrt(1 + slope * slope);
      bio.weights({ x, z, h, ny, nz: (h - hz) / 1.5, roadEdge }, weights);
      const river = mountain.riverDistance(x, z);
      const convex = Math.max(0, -bio.curvature);
      const rockMat = weights[Mat.RockLight] + weights[Mat.RockDark] + weights[Mat.SnowRock];
      const outcrop = rockMat * (0.5 + convex) * 0.07 + bio.rough * convex * 0.05;
      const talus = weights[Mat.Scree] * 0.05;
      const bed = river < 9 ? 0.07 * (1 - river / 9) : 0;
      const side = roadEdge > 1.5 && roadEdge < 4 ? 0.008 : 0;
      const erratic = 0.0015;
      const k = def.props.rocks * Math.max(0.5, density);
      if (roll >= (outcrop + talus + bed + side + erratic) * k) continue;
      let rem = roll / k;
      let reason: RockReason;
      if ((rem -= outcrop) < 0) reason = 'outcrop';
      else if ((rem -= talus) < 0) reason = 'talus';
      else if ((rem -= bed) < 0) reason = 'streambed';
      else if ((rem -= side) < 0) reason = 'trailside';
      else reason = 'erratic';
      let type: RockType;
      let s: number;
      if (reason === 'outcrop') {
        type = slope > 0.9 && kindRoll < 0.3 ? 'rockSpire' : kindRoll < 0.55 ? 'rockSlab' : 'rock0';
        s = 1.2 + s0 * 2;
      } else if (reason === 'talus') {
        type = kindRoll < 0.5 ? 'rock1' : 'rock2';
        s = 0.5 + s0 * 1.1;
      } else if (reason === 'streambed') {
        type = 'rockRound';
        s = 0.4 + s0 * 0.9;
      } else if (reason === 'trailside') {
        type = kindRoll < 0.5 ? 'rockRound' : 'rock2';
        s = 0.35 + s0 * 0.45;
      } else {
        type = 'rock0';
        s = 1.2 + s0 * 1.2;
      }
      // A big rock must not reach into the trail.
      if (roadEdge < 0.95 * s + 0.4) continue;
      rocks.push(ROCK_TYPES.indexOf(type), x, h - 0.25 * s, z, s, rot, s > 0.6 ? 1 : 0);
      reasons.push(REASONS.indexOf(reason));
    }

  // --- Outcrops: clusters of 3–7 faceted rocks along the contour lines -----------------
  // Rate per biome (data/biomes.ts), boosted on convex ribs and crests; sizes fall off from
  // the middle of the cluster; never on (or reaching into) the driving line, never in water.
  const ob = 25;
  const orng = new Rng((cx * 15485863) ^ (cz * 32452843) ^ def.seed ^ 0xb01d);
  for (let gz = 0; gz < size; gz += ob)
    for (let gx = 0; gx < size; gx += ob) {
      const x = x0 + gx + orng.range(2, ob - 2);
      const z = z0 + gz + orng.range(2, ob - 2);
      const roll = orng.next();
      const n = 3 + Math.floor(orng.next() * 5);
      const gseed = Math.floor(orng.next() * 1e6);
      if (blocked(x, z, 3) || at(x, z, 9) > 0.01) continue;
      const fx = Math.max(0, Math.min(gn - 1, Math.round((x - x0) / step)));
      const fz = Math.max(0, Math.min(gn - 1, Math.round((z - z0) / step)));
      const biome = biomes[BIOME_IDS[D[(fz * gn + fx) * ECO_STRIDE + 10]]];
      const slope = at(x, z, 4);
      const rib = Math.max(0, -at(x, z, 11));
      const onSlope = smoothstep(0.12, 0.3, slope) * (1 - smoothstep(1.1, 1.5, slope));
      const rate = (biome.outcrops / 16) * (0.35 + onSlope) * (1 + 2.5 * rib);
      if (roll >= rate * def.props.rocks * Math.max(0.5, density)) continue;
      // Contour direction: perpendicular to the gradient.
      const hx = terrain.height(x + 2, z) - terrain.height(x - 2, z);
      const hz = terrain.height(x, z + 2) - terrain.height(x, z - 2);
      const gl = Math.hypot(hx, hz);
      const gr = new Rng(gseed ^ def.seed);
      const a0 = gr.range(0, Math.PI * 2);
      const tx = gl > 0.05 ? -hz / gl : Math.cos(a0);
      const tz = gl > 0.05 ? hx / gl : Math.sin(a0);
      let pos = -((n - 1) / 2) * 2.1;
      for (let k = 0; k < n; k++) {
        const mid = 1 - Math.abs(k - (n - 1) / 2) / Math.max(1, (n - 1) / 2);
        const sz = 0.5 + mid * 1.3 + gr.next() * 0.7;
        pos += k === 0 ? 0 : 1.2 + sz * 0.9 + gr.range(-0.3, 0.4);
        const off = gr.range(-0.9, 0.9);
        const px = x + tx * pos + tz * off;
        const pz = z + tz * pos - tx * off;
        if (blocked(px, pz, 1.2 * sz + 1.5)) continue;
        const h = terrain.height(px, pz);
        if (terrain.waterLevel(px, pz) > h - 0.3) continue;
        const type = gr.next() < 0.5 ? 'boulder0' : 'boulder1';
        rocks.push(ROCK_TYPES.indexOf(type), px, h - 0.22 * sz, pz, sz, gr.range(0, 6.28), 1);
        reasons.push(REASONS.indexOf('boulders'));
      }
    }

  return {
    cx,
    cz,
    full,
    trees: Float32Array.from(trees),
    rocks: Float32Array.from(rocks),
    rockReasons: Uint8Array.from(reasons),
    blobs: Float32Array.from(blobs),
  };
}

/** Reason of rock `i` of a cell (tests, debug). */
export const rockReason = (cell: CellData, i: number): RockReason => REASONS[cell.rockReasons[i]];
