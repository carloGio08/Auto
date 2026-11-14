import { Rng } from '../math/rng';
import { clamp } from '../math/util';
import type { MountainDef } from '../data/types';
import { Mountain } from './mountain';
import { createRoadPoint, Road, ROAD_BRIDGE, ROAD_HAIRPIN, type RoadPoint } from './road';
import { Terrain } from './terrain';
import { TrailRouter, type DenseLine } from './trailRouter';

export interface CollectiblePlacement {
  kind: 'coin' | 'crystal';
  x: number;
  y: number;
  z: number;
}

/** A small object next to a trail, oriented along it. */
export interface FurniturePlacement {
  x: number;
  y: number;
  z: number;
  /** Heading (radians from +Z towards +X) of the trail at that point. */
  heading: number;
}

export interface FencePlacement {
  trail: number;
  from: number;
  to: number;
  /** Signed lateral offset from the trail centre (+ = left). */
  lateral: number;
}

export interface SignPlacement extends FurniturePlacement {
  /** Heading of the arrow painted on the sign (towards the base). */
  arrow: number;
}

/**
 * Everything derived from a mountain definition: natural terrain, rivers, routed trails,
 * carved terrain and the placement of furniture and collectibles. Pure data (no three.js
 * objects), so it can be tested and reused.
 */
export class Course {
  readonly mountain: Mountain;
  readonly road: Road;
  readonly terrain: Terrain;
  readonly startS = 6;
  readonly finishS: number;
  readonly base: { x: number; y: number; z: number; radius: number };
  readonly start: { x: number; y: number; z: number; heading: number };
  readonly startAltitude: number;
  readonly collectibles: CollectiblePlacement[] = [];
  readonly waymarks: FurniturePlacement[] = [];
  readonly cairns: FurniturePlacement[] = [];
  readonly signs: SignPlacement[] = [];
  readonly fences: FencePlacement[] = [];

  constructor(readonly def: MountainDef) {
    this.mountain = new Mountain(def);
    this.mountain.buildRivers();
    const router = new TrailRouter(this.mountain);
    const lines = new Map<string, DenseLine>();
    for (const t of def.trails) lines.set(t.id, router.routeTrail(t, lines));
    this.road = new Road(
      def.trails,
      def.trails.map((t) => lines.get(t.id)!),
      this.mountain,
    );
    this.terrain = new Terrain(this.mountain, this.road);
    const L = this.road.length;
    const p = this.road.pointAt(this.startS, createRoadPoint());
    this.start = { x: p.x, y: p.y, z: p.z, heading: Math.atan2(p.tx, p.tz) };
    this.startAltitude = p.y;
    const by = this.terrain.height(def.base.x, def.base.z);
    this.base = { x: def.base.x, y: by, z: def.base.z, radius: def.base.radius };
    this.finishS = L;
    this.placeFurniture();
    this.placeCollectibles();
  }

  /** Whether a world point is inside the arrival zone at the base. */
  inBase(x: number, z: number): boolean {
    return Math.hypot(x - this.base.x, z - this.base.z) < this.base.radius;
  }

  private sidePoint(p: RoadPoint, lateral: number, lift = 0): FurniturePlacement {
    const x = p.x + p.tz * lateral;
    const z = p.z - p.tx * lateral;
    return {
      x,
      y: this.terrain.groundHeight(x, z, p.y + 3) + lift,
      z,
      heading: Math.atan2(p.tx, p.tz),
    };
  }

  private placeFurniture(): void {
    const road = this.road;
    const p = createRoadPoint();
    const b = this.def.biomes;
    road.trails.forEach((tr, ti) => {
      // Painted waymark posts on alternating sides; cairns above the tree line.
      let side = 1;
      for (let s = 30; s < tr.length - 20; s += ti === 0 ? 70 : 90) {
        road.pointAt(s, p, ti);
        if (road.flags[p.index] & ROAD_BRIDGE) continue;
        side = -side;
        const placement = this.sidePoint(p, side * (p.halfWidth + 1.2));
        if (p.y > b.treeLine) this.cairns.push(this.sidePoint(p, side * (p.halfWidth + 1.8)));
        else this.waymarks.push(placement);
      }
      // Signs pointing to the base at junctions and every ~600 m.
      for (let s = 120; s < tr.length - 60; s += 600) {
        road.pointAt(s, p, ti);
        if (road.flags[p.index] & ROAD_BRIDGE) continue;
        const sp = this.sidePoint(p, -(p.halfWidth + 2.2));
        this.signs.push({
          ...sp,
          arrow: Math.atan2(this.def.base.x - sp.x, this.def.base.z - sp.z),
        });
      }
      // Wooden fences on the outside of hairpins.
      let i = 0;
      while (i < tr.count) {
        const g = tr.start + i;
        if (!(road.flags[g] & ROAD_HAIRPIN) || road.flags[g] & ROAD_BRIDGE) {
          i++;
          continue;
        }
        let j = i;
        while (j < tr.count && road.flags[tr.start + j] & ROAD_HAIRPIN) j++;
        const mid = tr.start + Math.floor((i + j) / 2);
        const sideF = road.curvature[mid] > 0 ? -1 : 1;
        const from = Math.max(0, i - 3) * road.spacing;
        const to = Math.min(tr.count - 1, j + 3) * road.spacing;
        if (to - from > 14)
          this.fences.push({ trail: ti, from, to, lateral: sideF * (road.halfWidth[mid] + 1.4) });
        i = j;
      }
    });
    // Fences along the last stretch into the village.
    const L = road.length;
    this.fences.push({
      trail: 0,
      from: Math.max(0, L - 140),
      to: L - 4,
      lateral: road.halfWidth[road.main.start + road.main.count - 1] + 3,
    });
  }

  private placeCollectibles(): void {
    const rng = new Rng(this.def.seed ^ 0xc011ec7);
    const road = this.road;
    const p = createRoadPoint();
    const terrain = this.terrain;
    const L = road.length;
    const coins = this.def.collectibles.coins;
    // Coin lines along the main trail (6 coins weaving across the trail).
    const lines = Math.max(1, Math.round((coins * 0.7) / 6));
    for (let l = 0; l < lines; l++) {
      const s0 = 80 + ((L - 200) * (l + rng.next() * 0.6)) / lines;
      const lane = rng.range(-0.5, 0.5);
      const drift = rng.range(-0.08, 0.08);
      for (let k = 0; k < 6; k++) {
        road.pointAt(s0 + k * 7, p);
        const lat = clamp(lane + drift * k, -0.6, 0.6) * p.halfWidth;
        const fp = this.sidePoint(p, lat, 1.1);
        this.collectibles.push({ kind: 'coin', x: fp.x, y: fp.y, z: fp.z });
      }
    }
    // Branch trails: sparser coin lines.
    for (let ti = 1; ti < road.trails.length; ti++) {
      const tr = road.trails[ti];
      for (let s = 60; s < tr.length - 40; s += 160) {
        for (let k = 0; k < 4; k++) {
          road.pointAt(s + k * 7, p, ti);
          const fp = this.sidePoint(p, 0, 1.1);
          this.collectibles.push({ kind: 'coin', x: fp.x, y: fp.y, z: fp.z });
        }
      }
    }
    // Off-trail coin rings and crystals in harder places (away from the trail, on slopes).
    const off = Math.round((coins * 0.3) / 5);
    for (let k = 0; k < off; k++) {
      road.pointAt(rng.range(100, L - 100), p);
      const side = rng.chance(0.5) ? 1 : -1;
      const d = rng.range(25, 70);
      const cx = p.x + p.tz * side * d;
      const cz = p.z - p.tx * side * d;
      for (let c = 0; c < 5; c++) {
        const a = (c / 5) * Math.PI * 2;
        const x = cx + Math.cos(a) * 4;
        const z = cz + Math.sin(a) * 4;
        const y = terrain.height(x, z) + 1.1;
        if (terrain.waterLevel(x, z) < y - 1.5) this.collectibles.push({ kind: 'coin', x, y, z });
      }
    }
    let crystals = 0;
    let guard = 0;
    while (crystals < this.def.collectibles.crystals && guard++ < 500) {
      road.pointAt(rng.range(150, L - 150), p);
      const side = rng.chance(0.5) ? 1 : -1;
      const d = rng.range(40, 140);
      const x = p.x + p.tz * side * d;
      const z = p.z - p.tx * side * d;
      const y = terrain.height(x, z) + 1.4;
      if (terrain.waterLevel(x, z) > y - 2) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) > this.def.halfSize * 0.8) continue;
      this.collectibles.push({ kind: 'crystal', x, y, z });
      crystals++;
    }
  }
}
