import { Vector3 } from 'three';
import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import { config } from '../config';
import type { PaletteKey, SurfaceId } from '../data/types';
import type { Mountain } from './mountain';
import { createRoadQuery, ROAD_BRIDGE, type Road, type RoadQuery } from './road';

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
  key: PaletteKey;
  surface: SurfaceId;
}

const SURFACE_OF: Record<PaletteKey, SurfaceId> = {
  snow: 'snow',
  rock: 'rock',
  scree: 'scree',
  alpine: 'grass',
  meadow: 'grass',
  forest: 'forest',
  denseForest: 'forest',
  trail: 'trail',
  sand: 'sand',
  water: 'sand',
  wood: 'wood',
  foliage: 'forest',
  paint: 'rock',
};

/** Upper bound of the adaptive trail shoulder (m). Road.influence must cover it. */
export const MAX_SHOULDER = 30;

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
  private readonly biome: BiomeResult = { key: 'meadow', surface: 'grass' };

  constructor(
    readonly mountain: Mountain,
    readonly road: Road,
  ) {
    this.snowNoise = new Simplex2(mountain.def.seed ^ 0x51f0);
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
    const d1 = q.distance;
    if (d1 >= hw + MAX_SHOULDER) return n;
    const lat1 = Math.max(-hw, Math.min(hw, q.lateral));
    const r1 = q.y + q.bank * lat1 - this.crown * Math.min(1, (d1 / hw) * (d1 / hw));
    // Embankments widen with the cut/fill height so they stay below ~50°.
    const sh = Math.min(MAX_SHOULDER, Math.max(this.shoulder, Math.abs(r1 - n) * 1.25));
    if (d1 >= hw + sh) return n;
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
    const blend = (1 - smoothstep(hw, hw + sh, d1)) * q.carve;
    return n + (hr - n) * blend;
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
    if (onBridge) out.surface = 'wood';
    else
      out.surface = this.surfaceAt(
        x,
        z,
        out.height,
        out.normal.y,
        q.found ? q.distance : Infinity,
        q.found ? q.halfWidth : 0,
      );
    return out;
  }

  /** Physics surface at a point (patches > trail > biome). */
  surfaceAt(
    x: number,
    z: number,
    h: number,
    normalY: number,
    roadDistance: number,
    halfWidth: number,
  ): SurfaceId {
    for (const p of this.patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < p.radius * p.radius) return p.surface;
    }
    return this.classify(x, z, h, normalY, roadDistance, halfWidth).surface;
  }

  /** Low-frequency wobble so biome bands are organic but still crisp. */
  private wobble(x: number, z: number): number {
    return 28 * Math.sin(x / 240 + z / 610) + 22 * Math.cos(z / 190 - x / 830);
  }

  /** Snow covering part of the trail high up (patches, not a gradient). */
  trailSnow(x: number, z: number, h: number): boolean {
    const b = this.mountain.def.biomes;
    const amount = smoothstep(b.snowLine - 120, b.snowLine + 60, h + this.wobble(x, z));
    if (amount <= 0) return false;
    // At most ~45 % of the trail is covered so it stays readable in the snow.
    return this.snowNoise.noise(x / 22, z / 22) * 0.5 + 0.5 < amount * 0.45;
  }

  /**
   * Biome of a point: palette entry and surface. Bands by altitude and slope, the trail in
   * the middle (packed dirt), snow, rock or grass at its edges depending on the altitude.
   */
  classify(
    x: number,
    z: number,
    h: number,
    ny: number,
    roadDistance: number,
    halfWidth: number,
  ): BiomeResult {
    const r = this.biome;
    const b = this.mountain.def.biomes;
    const hw = h + this.wobble(x, z);
    if (roadDistance < halfWidth * 0.8) {
      if (this.trailSnow(x, z, h)) {
        r.key = 'snow';
        r.surface = 'snow';
      } else {
        r.key = 'trail';
        r.surface = 'trail';
      }
      return r;
    }
    let key: PaletteKey;
    if (h < this.mountain.def.lake.level + 2.5) key = 'sand';
    else if (ny < 0.7) key = 'rock';
    else if (hw > b.snowLine && ny > 0.66) key = 'snow';
    else if (hw > b.rockLine) key = ny < 0.86 ? 'rock' : ny < 0.93 ? 'scree' : 'alpine';
    else if (hw > b.treeLine) key = ny < 0.8 ? 'scree' : 'alpine';
    else if (hw > b.denseForestLine) key = ny < 0.76 ? 'rock' : 'forest';
    else if (hw > b.valleyLine) key = 'denseForest';
    else key = 'meadow';
    // Trail edges: a narrow band of packed ground before the biome takes over.
    if (
      roadDistance < halfWidth * 1.15 &&
      (key === 'meadow' || key === 'forest' || key === 'denseForest' || key === 'alpine')
    ) {
      key = 'trail';
    }
    r.key = key;
    r.surface = SURFACE_OF[key];
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
