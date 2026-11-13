import { Vector3 } from 'three';
import { clamp, smoothstep } from '../math/util';
import { config } from '../config';
import type { SurfaceId } from '../data/types';
import type { Mountain } from './mountain';
import { createRoadQuery, ROAD_BRIDGE, SURFACE_IDS, type Road, type RoadQuery } from './road';

/** An off-road shortcut corridor between two points of the road. */
export interface Shortcut {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  sFrom: number;
  sTo: number;
  halfWidth: number;
  surface: SurfaceId;
  kickers: { x: number; z: number; dx: number; dz: number; height: number; length: number }[];
}

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
  /** Distance along the road of the closest road point (or -1). */
  s: number;
  lateral: number;
}

export const createGroundSample = (): GroundSample => ({
  height: 0,
  normal: new Vector3(0, 1, 0),
  surface: 'dirt',
  onRoad: false,
  onBridge: false,
  s: -1,
  lateral: 0,
});

/**
 * Final terrain: natural mountain + road carve + shortcut kickers. `height(x,z)` is the
 * analytic height used both for meshes and physics.
 */
export class Terrain {
  readonly patches: SurfacePatch[] = [];
  private readonly q: RoadQuery = createRoadQuery();
  private readonly qg: RoadQuery = createRoadQuery();
  private readonly shoulder = config.world.roadShoulder;
  private readonly crown = config.world.roadCrown;

  constructor(
    readonly mountain: Mountain,
    readonly road: Road,
    readonly shortcuts: Shortcut[],
  ) {}

  /** Road query filled by the last `height()` call (read-only, reused). */
  get lastQuery(): RoadQuery {
    return this.q;
  }

  /** Analytic terrain height (no bridge decks). */
  height(x: number, z: number): number {
    return this.heightWith(x, z, this.q);
  }

  private heightWith(x: number, z: number, q: RoadQuery): number {
    let n = this.mountain.height(x, z);
    if (this.shortcuts.length) n += this.shortcutBump(x, z);
    this.road.query(x, z, q);
    if (!q.found) return n;
    const hw = q.halfWidth;
    const d1 = q.distance;
    if (d1 >= hw + MAX_SHOULDER) return n;
    const r1 = q.y - this.crown * Math.min(1, (d1 / hw) * (d1 / hw));
    // Embankments widen with the height difference so cuts and fills stay below ~50°.
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
        const r2 = q.y2 - this.crown * Math.min(1, (d2 / hw2) * (d2 / hw2));
        hr = (r1 * k1 + r2 * k2) / (k1 + k2);
      }
    }
    const blend = (1 - smoothstep(hw, hw + sh, d1)) * q.carve;
    return n + (hr - n) * blend;
  }

  /** Small ramps placed on shortcuts. */
  private shortcutBump(x: number, z: number): number {
    let h = 0;
    for (const sc of this.shortcuts) {
      for (const k of sc.kickers) {
        const rx = x - k.x;
        const rz = z - k.z;
        const along = rx * k.dx + rz * k.dz; // ramp rises along +dir, lip at 0
        const across = Math.abs(rx * k.dz - rz * k.dx);
        if (along < -k.length || along > 1.5 || across > 4.5) continue;
        const side = 1 - smoothstep(3, 4.5, across);
        const prof = along <= 0 ? Math.pow((along + k.length) / k.length, 1.6) : 1 - along / 1.5;
        h += k.height * prof * side;
      }
    }
    return h;
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

  private onBridgeSegment(i: number): boolean {
    const f = this.road.flags;
    return ((f[i] | f[Math.min(i + 1, f.length - 1)]) & ROAD_BRIDGE) !== 0;
  }

  /** Normal of the analytic terrain (finite differences). */
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
    out.onRoad = q.found && q.distance <= q.halfWidth + 0.3 && Math.abs(out.height - q.y) < 1.2;
    out.s = q.found ? q.s : -1;
    out.lateral = q.found ? q.lateral : 0;
    const roadSurface = q.found ? SURFACE_IDS[this.road.surface[q.index]] : 'dirt';
    const distance = q.found ? q.distance : Infinity;
    const halfWidth = q.found ? q.halfWidth : 0;
    this.normal(x, z, out.normal, yRef);
    out.surface = this.surfaceAt(
      x,
      z,
      out.height,
      out.normal.y,
      out.onRoad || onBridge,
      roadSurface,
      distance,
      halfWidth,
    );
    return out;
  }

  /** Surface classification shared by physics, particles and audio. */
  surfaceAt(
    x: number,
    z: number,
    h: number,
    normalY: number,
    onRoad: boolean,
    roadSurface: SurfaceId,
    roadDistance: number,
    halfWidth: number,
  ): SurfaceId {
    for (const p of this.patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < p.radius * p.radius) return p.surface;
    }
    if (onRoad) return roadSurface;
    for (const sc of this.shortcuts) {
      if (distanceToSegment(x, z, sc.ax, sc.az, sc.bx, sc.bz) < sc.halfWidth) return sc.surface;
    }
    if (roadDistance < halfWidth + 2.5)
      return roadSurface === 'snow' || roadSurface === 'ice' ? 'snow' : 'dirt';
    return this.naturalSurface(x, z, h, normalY);
  }

  naturalSurface(x: number, z: number, h: number, normalY: number): SurfaceId {
    const def = this.mountain.def;
    const wobble = Math.sin(x * 0.05) * 8 + Math.cos(z * 0.043) * 8;
    if (h > def.snowLine + wobble && normalY > 0.7) return 'snow';
    if (normalY < 0.8) return 'rock';
    if (h < def.lakeLevel + 2.5) return 'sand';
    return 'grass';
  }

  waterLevel(x: number, z: number): number {
    return this.mountain.waterLevel(x, z);
  }

  /** Signed lateral offset → world position on the road at distance s (y on the surface). */
  roadPosition(s: number, lateral: number, out: Vector3): Vector3 {
    const p = this.road.pointAt(s, tmpPoint);
    out.set(p.x + p.tz * lateral, 0, p.z - p.tx * lateral);
    out.y = this.groundHeight(out.x, out.z, p.y + 3);
    return out;
  }
}

/** Upper bound of the adaptive road shoulder (m). Road.influence must cover it. */
export const MAX_SHOULDER = 30;

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
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
