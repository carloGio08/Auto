import { Vector3 } from 'three';
import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import { config } from '../config';
import type { SurfaceId } from '../data/types';
import { BiomeModel, Mat, MATERIAL_SURFACE, type Material } from './biome';
import type { Mountain } from './mountain';
import { hash2 } from '../math/rng';
import {
  createRoadQuery,
  ROAD_BRIDGE,
  ROAD_FORD,
  SURF_GRASSY,
  SURF_GRAVEL,
  type Road,
  type RoadQuery,
} from './road';

/** A temporary/zone surface override (mud pool, ice patch). */
export interface SurfacePatch {
  x: number;
  z: number;
  radius: number;
  surface: SurfaceId;
}

export interface GroundSample {
  height: number;
  normal: Vector3;
  surface: SurfaceId;
  onRoad: boolean;
  onBridge: boolean;
  /** Distance along the closest trail (or -1) and lateral offset. */
  s: number;
  lateral: number;
}

export const createGroundSample = (): GroundSample => ({
  height: 0,
  normal: new Vector3(0, 1, 0),
  surface: 'trail',
  onRoad: false,
  onBridge: false,
  s: -1,
  lateral: 0,
});

/** Biome classification shared by the terrain colours and the physics surfaces. */
export interface BiomeResult {
  key: Material;
  surface: SurfaceId;
}

/** Kind of ground on the worn band of a trail (colours and physics). */
export type TrailGround = 'dirt' | 'gravel' | 'grass' | 'rut' | 'mud' | 'snow' | 'ford';

const TRAIL_SURFACE: Record<TrailGround, SurfaceId> = {
  dirt: 'trail',
  rut: 'trail',
  gravel: 'gravel',
  grass: 'grass',
  mud: 'mud',
  snow: 'snow',
  ford: 'gravel',
};

/** Upper bound of the adaptive trail shoulder (m). Road.influence must cover it. */
export const MAX_SHOULDER = 30;
/** Flat strip beside the trail before the ditch / embankment (m). */
const SHOULDER = 0.7;
/** Depth of the drainage ditch on the cut side (m). */
const DITCH = 0.32;
const PUDDLE_CELL = 40;
const PUDDLE_DEPTH = 0.12;

/**
 * Final terrain: natural mountain + trails carved in with banking, crown and soft embankments.
 * `height(x, z)` is the analytic height used both for meshes and physics.
 */
export class Terrain {
  readonly patches: SurfacePatch[] = [];
  private readonly q: RoadQuery = createRoadQuery();
  private readonly qg: RoadQuery = createRoadQuery();
  private readonly shoulder = config.world.roadShoulder;
  private readonly crown = config.world.roadCrown;
  private readonly snowNoise: Simplex2;
  private readonly biome: BiomeResult = { key: 'grass', surface: 'grass' };
  /** Ecology shared by colours, surfaces and vegetation. */
  readonly biomes: BiomeModel;
  private readonly w = new Float32Array(Mat.Count);
  private readonly seed: number;
  /** No puddles above this altitude (snow, frozen ground). */
  private readonly puddleLine: number;

  constructor(
    readonly mountain: Mountain,
    readonly road: Road,
  ) {
    this.snowNoise = new Simplex2(mountain.def.seed ^ 0x51f0);
    this.biomes = new BiomeModel(mountain);
    this.seed = mountain.def.seed & 0xffff;
    this.puddleLine = mountain.def.biomes.snowLine - 150;
  }

  /** Trail query filled by the last `height()` call (read-only, reused). */
  get lastQuery(): RoadQuery {
    return this.q;
  }

  /** Analytic terrain height (no bridge decks). */
  height(x: number, z: number): number {
    return this.heightWith(x, z, this.q);
  }

  private heightWith(x: number, z: number, q: RoadQuery): number {
    const n = this.mountain.height(x, z);
    this.road.query(x, z, q);
    if (!q.found) return n;
    const hw = q.halfWidth;
    // Distance to the flat band (shifted by lay-bys and the meander of the edges).
    const latB = q.lateral - q.offset;
    const d1 = Math.abs(latB) + Math.max(0, q.distance - Math.abs(q.lateral));
    if (d1 >= hw + MAX_SHOULDER) return n;
    const lat1 = Math.max(-hw, Math.min(hw, latB)) + q.offset;
    let r1 = q.y + q.bank * lat1 - this.crown * Math.min(1, (d1 / hw) * (d1 / hw));
    // Micro relief inside the band: wheel ruts, grass hump of old two-tracks, puddles.
    if (d1 < hw + 0.5) r1 -= this.microRelief(q, q.lateral);
    // Embankments widen with the cut/fill height so they stay below ~50°.
    const sh = Math.min(MAX_SHOULDER, Math.max(this.shoulder, Math.abs(r1 - n) * 1.25));
    if (d1 >= hw + SHOULDER + sh) return n;
    let hr = r1;
    if (q.found2) {
      const hw2 = q.halfWidth2;
      const d2 = q.distance2;
      const fade = (1 - smoothstep(hw2 + sh, hw2 + sh + 8, d2)) * q.weight2;
      if (fade > 0) {
        const e1 = Math.max(d1 - hw, 0) + 0.3;
        const e2 = Math.max(d2 - hw2, 0) + 0.3;
        const k1 = 1 / (e1 * e1);
        const k2 = fade / (e2 * e2);
        const lat2 = Math.max(-hw2, Math.min(hw2, q.lateral2));
        const r2 = q.y2 + q.bank2 * lat2 - this.crown * Math.min(1, (d2 / hw2) * (d2 / hw2));
        hr = (r1 * k1 + r2 * k2) / (k1 + k2);
      }
    }
    // Drainage ditch on the cut side (the natural ground is above the trail), after a
    // narrow flat shoulder.
    const e = d1 - hw;
    if (e > SHOULDER * 0.6 && n > hr + 0.4 && !(q.flags & ROAD_FORD)) {
      const u = (e - SHOULDER * 0.6 - 0.8) / 0.8;
      if (u > -1 && u < 1) hr -= DITCH * (1 - u * u) * smoothstep(0.4, 1.4, n - hr);
    }
    // Cut and fill blend into the natural slope with rounded crest and toe.
    const t = smoothstep(hw + SHOULDER, hw + SHOULDER + sh, d1);
    const blend = (1 - t) * q.carve;
    const out = n + (hr - n) * blend;
    // Under bridge decks the ground is only ever cut down, never above the deck.
    if (q.carve < 1) return Math.min(out, out + (hr - 0.8 - out) * (1 - t) * (1 - q.carve));
    return out;
  }

  /** Depth (m) of ruts, puddles and the grassy hump at a lateral position on the trail. */
  microRelief(q: RoadQuery, lateral: number): number {
    if (q.flags & (ROAD_BRIDGE | ROAD_FORD)) return 0;
    let d = 0;
    const a = Math.abs(lateral);
    // Two wheel ruts ±0.85 m from the centre line.
    const u = (a - 0.85) / 0.38;
    if (u > -1 && u < 1) d += q.rut * (1 - u * u) * (1 - u * u);
    // Grass hump in the middle of old two-tracks.
    if (q.surf === SURF_GRASSY && a < 0.6) d -= 0.05 * (1 - (a / 0.6) ** 2);
    if (q.y < this.puddleLine) d += this.puddle(q.trail, q.s, lateral, q.surf) * PUDDLE_DEPTH;
    return d;
  }

  /**
   * Puddle strength (0..1) at a point of a trail: a few shallow muddy hollows, one per
   * ~40 m cell at most, off-centre, never on gravel or in the snow.
   */
  puddle(trail: number, s: number, lateral: number, surf: number): number {
    if (surf === SURF_GRAVEL) return 0;
    const cell = Math.floor(s / PUDDLE_CELL);
    let best = 0;
    for (let c = cell - 1; c <= cell + 1; c++) {
      const hsh = hash2(c, trail, this.seed);
      if (hsh > 0.24) continue;
      const sc = (c + 0.3 + hsh * 1.7) * PUDDLE_CELL;
      const lc = (hash2(c, trail + 7, this.seed) - 0.5) * 1.8;
      const len = 1.6 + hsh * 6;
      const du = (s - sc) / len;
      const dv = (lateral - lc) / 1.25;
      const r2 = du * du + dv * dv;
      if (r2 < 1) best = Math.max(best, (1 - r2) * (1 - r2));
    }
    return best;
  }

  private onBridgeSegment(i: number): boolean {
    const f = this.road.flags;
    return ((f[i] | f[Math.min(i + 1, f.length - 1)]) & ROAD_BRIDGE) !== 0;
  }

  /**
   * Height of the drivable ground: terrain, or a bridge deck when the point is on a bridge and
   * `yRef` (e.g. the wheel mount height) is above the deck.
   */
  groundHeight(x: number, z: number, yRef: number): number {
    const h = this.heightWith(x, z, this.qg);
    const q = this.qg;
    if (
      q.found &&
      this.onBridgeSegment(q.index) &&
      q.distance < q.halfWidth + 0.4 &&
      yRef > q.y - 2.2
    ) {
      return Math.max(h, q.y);
    }
    return h;
  }

  /** Normal of the analytic ground (finite differences). */
  normal(x: number, z: number, out: Vector3, yRef = Infinity): Vector3 {
    const e = 0.6;
    const hl = this.groundHeight(x - e, z, yRef);
    const hr = this.groundHeight(x + e, z, yRef);
    const hd = this.groundHeight(x, z - e, yRef);
    const hu = this.groundHeight(x, z + e, yRef);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
    return out;
  }

  /** Full ground sample used by the wheels. */
  sample(x: number, z: number, yRef: number, out: GroundSample): GroundSample {
    out.height = this.groundHeight(x, z, yRef);
    const q = this.qg;
    const onBridge =
      q.found &&
      this.onBridgeSegment(q.index) &&
      q.distance < q.halfWidth + 0.4 &&
      yRef > q.y - 2.2;
    out.onBridge = onBridge;
    out.onRoad = q.found && q.distance <= q.halfWidth + 0.3 && Math.abs(out.height - q.y) < 1.5;
    out.s = q.found ? q.s : -1;
    out.lateral = q.found ? q.lateral : 0;
    this.normal(x, z, out.normal, yRef);
    const tg =
      q.found && !onBridge ? this.trailGround(q.trail, q.s, q.lateral, x, z, out.height) : null;
    if (onBridge) out.surface = 'wood';
    else if (tg && !this.patchAt(x, z)) out.surface = TRAIL_SURFACE[tg];
    else
      out.surface = this.surfaceAt(
        x,
        z,
        out.height,
        out.normal.y,
        out.normal.z,
        q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : Infinity,
      );
    return out;
  }

  /**
   * Ground on the worn band of trail `trail` at distance `s` and lateral offset `lateral`
   * (null off the band or on a bridge deck). The band edge is irregular, stretches change
   * between packed dirt, gravel and grassy two-tracks, with ruts, puddles and snow up high.
   */
  trailGround(
    trail: number,
    s: number,
    lateral: number,
    x: number,
    z: number,
    h: number,
    ignoreEdge = false,
  ): TrailGround | null {
    if (trail < 0) return null;
    const road = this.road;
    const tr = road.trails[trail];
    if (!tr) return null;
    const g = tr.start + Math.max(0, Math.min(tr.count - 1, Math.round(s / road.spacing)));
    const hw = road.halfWidth[g];
    const latB = lateral - road.offset[g];
    const edge = this.bandEdge(hw, s, latB, x);
    if (!ignoreEdge && Math.abs(latB) > edge) return null;
    const f = road.flags[g];
    if (f & ROAD_BRIDGE) return null;
    if (f & ROAD_FORD) return 'ford';
    if (this.trailSnow(x, z, h)) return 'snow';
    const surf = road.surf[g];
    if (h < this.puddleLine && this.puddle(trail, s, lateral, surf) > 0.2) return 'mud';
    const a = Math.abs(lateral);
    if (surf === SURF_GRASSY && a < 0.42) return 'grass';
    if (surf !== SURF_GRAVEL && road.rut[g] > 0.045 && Math.abs(a - 0.85) < 0.2) return 'rut';
    return surf === SURF_GRAVEL ? 'gravel' : 'dirt';
  }

  private patchAt(x: number, z: number): boolean {
    for (const p of this.patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < p.radius * p.radius) return true;
    }
    return false;
  }

  /** Irregular edge of the worn band (m from its centre): wanders ±25 cm. */
  bandEdge(hw: number, s: number, latB: number, x: number): number {
    return (
      hw * 0.94 +
      0.22 * Math.sin(s / 3.7 + (latB > 0 ? 2.1 : 0)) +
      0.12 * Math.sin(s / 1.9 + x * 0.3)
    );
  }

  /** Physics surface at a point (patches > biome). */
  surfaceAt(x: number, z: number, h: number, ny: number, nz: number, roadEdge: number): SurfaceId {
    for (const p of this.patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < p.radius * p.radius) return p.surface;
    }
    return this.classify(x, z, h, ny, nz, roadEdge).surface;
  }

  /** Snow covering part of the trail high up (patches, not a gradient). */
  trailSnow(x: number, z: number, h: number): boolean {
    const b = this.mountain.def.biomes;
    const amount = smoothstep(b.snowLine - 120, b.snowLine + 60, h + this.biomes.wobble(x, z));
    if (amount <= 0) return false;
    // At most ~45 % of the trail is covered so it stays readable in the snow.
    return this.snowNoise.noise(x / 22, z / 22) * 0.5 + 0.5 < amount * 0.45;
  }

  /**
   * Dominant material of a point and its physics surface, from the same weights that colour
   * the terrain (what you see is what you drive on).
   */
  classify(x: number, z: number, h: number, ny: number, nz: number, roadEdge: number): BiomeResult {
    const r = this.biome;
    this.biomes.weights({ x, z, h, ny, nz, roadEdge }, this.w);
    r.key = BiomeModel.dominant(this.w);
    r.surface = MATERIAL_SURFACE[r.key];
    return r;
  }

  waterLevel(x: number, z: number): number {
    return this.mountain.waterLevel(x, z);
  }

  /** World position at distance s along a trail and lateral offset (y on the ground). */
  roadPosition(s: number, lateral: number, out: Vector3, trail = 0): Vector3 {
    const p = this.road.pointAt(s, tmpPoint, trail);
    out.set(p.x + p.tz * lateral, 0, p.z - p.tx * lateral);
    out.y = this.groundHeight(out.x, out.z, p.y + 3);
    return out;
  }
}

const tmpPoint = { x: 0, y: 0, z: 0, tx: 0, tz: 1, halfWidth: 5, s: 0, index: 0 };

export function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-6;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
