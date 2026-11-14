import { Rng } from '../math/rng';
import { smoothstep } from '../math/util';
import type { Course } from '../terrain/course';
import { Mat } from '../terrain/biome';

/** Every instanced prop type, in draw order. */
export const PROP_TYPES = [
  'pineYoung0',
  'pineYoung1',
  'pineMid0',
  'pineMid1',
  'roundMid',
  'pineOld0',
  'pineOld1',
  'pineSnow',
  'bush0',
  'bush1',
  'rock0',
  'rock1',
  'rock2',
  'rockSlab',
  'rockSpire',
  'rockRound',
  'stump',
] as const;
export type PropType = (typeof PROP_TYPES)[number];

export const isRock = (t: PropType): boolean => t.startsWith('rock');

/** One placed instance. */
export interface PropInstance {
  type: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
}

/** Why a rock is where it is (tests, debug overlay). */
export type RockReason = 'outcrop' | 'talus' | 'streambed' | 'trailside' | 'erratic';

export interface CellPlacement {
  instances: PropInstance[];
  /** Rocks big enough to collide with: x, z, radius, bottom, top. */
  rockColliders: [number, number, number, number, number][];
  rockReasons: RockReason[];
}

const T = (t: PropType): number => PROP_TYPES.indexOf(t);
const weights = new Float32Array(Mat.Count);

/**
 * Deterministic vegetation and rock placement for one square cell (pure: no three.js).
 *
 * - Trees follow the same forest density as the ground colours (altitude, slope, wetness,
 *   clearings): meadows and terraces stay open, valleys and medium slopes are wooded, the
 *   tree line is sparse. Young (breakable) trees grow near the trails, old ones deep inside.
 * - Rocks only where they make sense: outcrops on crests and faces, talus under the faces,
 *   stream beds, a few stones beside trails. Never on the worn band of a trail.
 */
export function placeCell(
  course: Course,
  cx: number,
  cz: number,
  size: number,
  density: number,
): CellPlacement {
  const terrain = course.terrain;
  const bio = terrain.biomes;
  const mountain = course.mountain;
  const def = course.def;
  const b = def.biomes;
  const out: CellPlacement = { instances: [], rockColliders: [], rockReasons: [] };
  const rng = new Rng((cx * 73856093) ^ (cz * 19349663) ^ def.seed);
  const x0 = cx * size;
  const z0 = cz * size;
  const step = 9;
  const lake = def.lake.level;
  for (let gz = 0; gz < size; gz += step) {
    for (let gx = 0; gx < size; gx += step) {
      const x = x0 + gx + rng.range(0, step);
      const z = z0 + gz + rng.range(0, step);
      const roll = rng.next();
      const kindRoll = rng.next();
      const rot = rng.range(0, Math.PI * 2);
      const sc = rng.range(0.8, 1.25);
      if (Math.max(Math.abs(x), Math.abs(z)) > def.halfSize * 1.05) continue;
      const h = terrain.height(x, z);
      const q = terrain.lastQuery;
      // Distance from the edge of the worn band (lay-bys and meanders included).
      const roadEdge = q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : 1e4;
      if (roadEdge < 1.2) continue;
      if (h < lake + 1.2 || terrain.waterLevel(x, z) > h - 0.3) continue;
      if (Math.hypot(x - course.base.x, z - course.base.z) < course.base.radius + 25) continue;
      if (Math.hypot(x - course.start.x, z - course.start.z) < 40) continue;
      const hx = terrain.height(x + 1.5, z);
      const hz = terrain.height(x, z + 1.5);
      const slope = Math.hypot(hx - h, hz - h) / 1.5;
      const ny = 1 / Math.sqrt(1 + slope * slope);
      bio.weights({ x, z, h, ny, nz: (h - hz) / 1.5, roadEdge }, weights);
      const a = h + bio.wobble(x, z);

      // --- Rocks -----------------------------------------------------------------------
      const river = mountain.riverDistance(x, z);
      const convex = Math.max(0, -bio.curvature);
      const rockMat = weights[Mat.RockLight] + weights[Mat.RockDark] + weights[Mat.SnowRock];
      let reason: RockReason | null = null;
      let p = 0;
      const outcrop = rockMat * (0.5 + convex) * 0.07 + bio.rough * convex * 0.05;
      const talus = weights[Mat.Scree] * 0.05;
      const bed = river < 9 ? 0.07 * (1 - river / 9) : 0;
      const side = roadEdge > 1.5 && roadEdge < 4 ? 0.008 : 0;
      const erratic = 0.0015;
      p = outcrop + talus + bed + side + erratic;
      if (roll < p * def.props.rocks * Math.max(0.5, density)) {
        // Pick the reason by weight (deterministic from the roll).
        let r = roll / (def.props.rocks * Math.max(0.5, density));
        if ((r -= outcrop) < 0) reason = 'outcrop';
        else if ((r -= talus) < 0) reason = 'talus';
        else if ((r -= bed) < 0) reason = 'streambed';
        else if ((r -= side) < 0) reason = 'trailside';
        else reason = 'erratic';
        let type: PropType;
        let s: number;
        if (reason === 'outcrop') {
          type =
            slope > 0.9 && kindRoll < 0.3 ? 'rockSpire' : kindRoll < 0.55 ? 'rockSlab' : 'rock0';
          s = rng.range(1.2, 3.2);
        } else if (reason === 'talus') {
          type = kindRoll < 0.5 ? 'rock1' : 'rock2';
          s = rng.range(0.5, 1.6);
        } else if (reason === 'streambed') {
          type = 'rockRound';
          s = rng.range(0.4, 1.3);
        } else if (reason === 'trailside') {
          type = kindRoll < 0.5 ? 'rockRound' : 'rock2';
          s = rng.range(0.35, 0.8);
        } else {
          type = 'rock0';
          s = rng.range(1.2, 2.4);
        }
        // A big rock must not reach into the trail.
        if (roadEdge < 0.95 * s + 0.4) continue;
        out.instances.push({ type: T(type), x, y: h - 0.25 * s, z, scale: s, rot });
        out.rockReasons.push(reason);
        if (s > 0.6) out.rockColliders.push([x, z, 0.95 * s, h - 1, h + 1.2 * s]);
        continue;
      }

      // --- Trees and bushes ------------------------------------------------------------
      const forest = bio.forest;
      const nearTrail = smoothstep(2.5, 12, roadEdge);
      const pTree = forest * 1.15 * (0.25 + 0.75 * nearTrail) * def.props.trees * density;
      if (roll > 0.3 && roll < 0.3 + pTree * 0.7) {
        // Young (breakable) near the trails, old deep in the forest.
        const deep = smoothstep(10, 60, roadEdge) * (0.4 + 0.6 * forest);
        const t = kindRoll + deep * 0.25;
        let type: PropType;
        if (a > b.treeLine - 100)
          type = t > 0.75 ? 'pineSnow' : t > 0.4 ? 'pineMid1' : 'pineYoung1';
        else if (t < 0.32) type = kindRoll < 0.16 ? 'pineYoung0' : 'pineYoung1';
        else if (t < 0.82)
          type =
            a < b.valleyLine + 200 && kindRoll < 0.55
              ? 'roundMid'
              : kindRoll < 0.6
                ? 'pineMid0'
                : 'pineMid1';
        else type = kindRoll < 0.9 ? 'pineOld0' : 'pineOld1';
        out.instances.push({ type: T(type), x, y: h - 0.15, z, scale: sc, rot });
        continue;
      }
      // Bushes at forest edges and in the undergrowth, a few in meadows.
      const pBush =
        (weights[Mat.Undergrowth] * 0.12 + weights[Mat.Grass] * 0.01) * def.props.bushes;
      if (roll > 0.92 && roll < 0.92 + pBush && a < b.treeLine + 60 && roadEdge > 1.8) {
        out.instances.push({
          type: T(kindRoll < 0.5 ? 'bush0' : 'bush1'),
          x,
          y: h - 0.05,
          z,
          scale: sc,
          rot,
        });
      }
    }
  }
  return out;
}
