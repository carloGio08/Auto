import { Rng } from '../math/rng';
import { clamp } from '../math/util';
import type { TrackDef } from '../data/types';
import { Mountain } from './mountain';
import { createRoadPoint, generateCenterline, Road, ROAD_BRIDGE, ROAD_HAIRPIN } from './road';
import { Terrain, type Shortcut } from './terrain';

export interface CollectiblePlacement {
  kind: 'coin' | 'crystal';
  x: number;
  y: number;
  z: number;
}

export interface RailPlacement {
  /** Road distance range and lateral offset (signed, + = left). */
  from: number;
  to: number;
  lateral: number;
  kind: 'guardrail' | 'bridge' | 'fence';
}

export interface SignPlacement {
  s: number;
  lateral: number;
  kind: 'chevronLeft' | 'chevronRight' | 'shortcut' | 'jump';
}

/**
 * Everything derived from a track definition: mountain, road, terrain and the placement of
 * gameplay objects. Pure data (no three.js objects) so it can be tested and reused.
 */
export class Course {
  readonly mountain: Mountain;
  readonly road: Road;
  readonly terrain: Terrain;
  readonly startS = 12;
  readonly finishS: number;
  readonly checkpoints: number[];
  readonly collectibles: CollectiblePlacement[] = [];
  readonly rails: RailPlacement[] = [];
  readonly signs: SignPlacement[] = [];
  readonly archS: number | null;

  constructor(readonly track: TrackDef) {
    const centerline = generateCenterline(track.layout, track.seed);
    const endZ = centerline.z[centerline.z.length - 1];
    const endX = centerline.x[centerline.x.length - 1];
    // Keep the river away from the final run-out (which also follows the fall line).
    let river = track.river;
    if (river && Math.abs(river.x - endX) < river.meander * 1.4 + 45) {
      const side = endX > 0 ? -1 : 1; // towards the middle of the face, where it crosses the legs
      river = { ...river, x: endX + side * (river.meander * 1.4 + 45) };
    }
    this.mountain = new Mountain(track.terrain, track.seed, endZ, river);
    this.road = new Road(track, this.mountain, centerline);
    const shortcuts = this.buildShortcuts();
    this.terrain = new Terrain(this.mountain, this.road, shortcuts);
    const L = this.road.length;
    this.finishS = L - 45;
    this.checkpoints = track.checkpoints.map((f) => clamp(f * L, 30, this.finishS - 30));
    const archS = track.arch !== undefined ? track.arch * L : null;
    this.archS = archS !== null && !this.road.isBridgeAt(archS, 30) ? archS : null;
    this.buildRails();
    this.buildSigns();
    this.buildCollectibles();
  }

  get shortcuts(): Shortcut[] {
    return this.terrain.shortcuts;
  }

  private buildShortcuts(): Shortcut[] {
    const road = this.road;
    const L = road.length;
    const out: Shortcut[] = [];
    const a = createRoadPoint();
    const b = createRoadPoint();
    for (const def of this.track.shortcuts) {
      // Search around the authored start for the spot where cutting straight down the fall
      // line to the next leg saves the most distance.
      let bestGain = 0;
      let sA = -1;
      let sB = -1;
      let best = 0;
      for (let cand = def.from * L - 90; cand <= def.from * L + 90; cand += 8) {
        if (cand < 40 || cand > L - 150) continue;
        road.pointAt(cand, a);
        const i0 = Math.ceil((cand + 90) / road.spacing);
        const i1 = Math.min(road.count - 10, Math.floor((cand + 520) / road.spacing));
        let bd = Infinity;
        let bi = -1;
        for (let i = i0; i <= i1; i++) {
          if (Math.abs(road.x[i] - a.x) > 6 || road.z[i] < a.z + 30) continue;
          const d = Math.hypot(road.x[i] - a.x, road.z[i] - a.z);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        if (bi < 0 || bd > 125) continue;
        const sb = bi * road.spacing;
        const gain = sb - cand - bd;
        if (gain > bestGain && !road.isBridgeAt(cand, 25) && !road.isBridgeAt(sb, 25)) {
          bestGain = gain;
          sA = cand;
          sB = sb;
          best = bd;
        }
      }
      if (sA < 0 || bestGain < 60) continue;
      if (out.some((o) => Math.abs(o.sFrom - sA) < 120)) continue;
      road.pointAt(sA, a);
      road.pointAt(sB, b);
      const dx = (b.x - a.x) / best;
      const dz = (b.z - a.z) / best;
      // Start/end at the road edge, not the centre line.
      const ax = a.x + dx * (a.halfWidth + 2);
      const az = a.z + dz * (a.halfWidth + 2);
      const bx = b.x - dx * (b.halfWidth + 2);
      const bz = b.z - dz * (b.halfWidth + 2);
      const len = Math.hypot(bx - ax, bz - az);
      const kickers: Shortcut['kickers'] = [];
      for (let k = 0; k < def.kickers; k++) {
        const f = (k + 1) / (def.kickers + 1);
        kickers.push({
          x: ax + (bx - ax) * f,
          z: az + (bz - az) * f,
          dx,
          dz,
          height: 1.3,
          length: 7,
        });
      }
      if (len > 20)
        out.push({
          ax,
          az,
          bx,
          bz,
          sFrom: sA,
          sTo: sB,
          halfWidth: 5.5,
          surface: def.surface,
          kickers,
        });
    }
    return out;
  }

  private buildRails(): void {
    const road = this.road;
    const n = road.count;
    // Guardrails on the outside of hairpins.
    let i = 0;
    while (i < n) {
      if (!(road.flags[i] & ROAD_HAIRPIN) || road.flags[i] & ROAD_BRIDGE) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && road.flags[j] & ROAD_HAIRPIN && !(road.flags[j] & ROAD_BRIDGE)) j++;
      const mid = Math.floor((i + j) / 2);
      const side = road.curvature[mid] > 0 ? -1 : 1;
      const from = Math.max(0, i - 4) * road.spacing;
      const to = Math.min(n - 1, j + 4) * road.spacing;
      if (to - from > 12)
        this.rails.push({
          from,
          to,
          lateral: side * (road.halfWidth[mid] + 1.1),
          kind: 'guardrail',
        });
      i = j;
    }
    for (const b of road.bridges) {
      const hw = road.halfWidth[Math.round((b.from + b.to) / 2 / road.spacing)];
      this.rails.push({ from: b.from, to: b.to, lateral: hw + 0.25, kind: 'bridge' });
      this.rails.push({ from: b.from, to: b.to, lateral: -(hw + 0.25), kind: 'bridge' });
    }
    // Fences along the run-in and run-out.
    const hw0 = road.halfWidth[0];
    this.rails.push({
      from: 0,
      to: Math.min(60, road.length * 0.05),
      lateral: hw0 + 3.5,
      kind: 'fence',
    });
    this.rails.push({
      from: 0,
      to: Math.min(60, road.length * 0.05),
      lateral: -(hw0 + 3.5),
      kind: 'fence',
    });
    this.rails.push({
      from: this.finishS - 60,
      to: road.length - 4,
      lateral: hw0 + 3.5,
      kind: 'fence',
    });
    this.rails.push({
      from: this.finishS - 60,
      to: road.length - 4,
      lateral: -(hw0 + 3.5),
      kind: 'fence',
    });
  }

  private buildSigns(): void {
    for (const rail of this.rails) {
      if (rail.kind !== 'guardrail') continue;
      // Chevrons before each hairpin, on the outside.
      const s = Math.max(5, rail.from - 18);
      this.signs.push({
        s,
        lateral: Math.sign(rail.lateral) * (this.road.halfWidth[0] + 2),
        kind: rail.lateral < 0 ? 'chevronLeft' : 'chevronRight',
      });
    }
    for (const sc of this.shortcuts) {
      this.signs.push({ s: Math.max(5, sc.sFrom - 10), lateral: 0, kind: 'shortcut' });
    }
    for (const j of this.road.jumps)
      this.signs.push({ s: Math.max(5, j.lip - 45), lateral: 0, kind: 'jump' });
    // Resolve lateral side for shortcut / jump signs: place on the right side.
    for (const sign of this.signs)
      if (sign.lateral === 0) sign.lateral = -(this.road.halfWidth[0] + 2.2);
  }

  private buildCollectibles(): void {
    const rng = new Rng(this.track.seed ^ 0xc011ec7);
    const road = this.road;
    const terrain = this.terrain;
    const p = createRoadPoint();
    const L = road.length;
    const coinsTarget = this.track.collectibles.coins;
    // Coin lines along the road, weaving across lanes.
    const lines = Math.max(1, Math.round(coinsTarget / 6));
    for (let l = 0; l < lines; l++) {
      const s0 = 60 + ((L - 160) * (l + rng.next() * 0.5)) / lines;
      const lane = rng.range(-0.55, 0.55);
      const drift = rng.range(-0.08, 0.08);
      for (let k = 0; k < 6; k++) {
        const s = s0 + k * 6;
        if (s > this.finishS - 10) break;
        road.pointAt(s, p);
        const lat = clamp(lane + drift * k, -0.7, 0.7) * p.halfWidth;
        this.collectibles.push(this.placeAt(p, lat, 1.1, 'coin'));
      }
    }
    // Coins arcing over each jump, crystal at the apex of the biggest ones.
    for (const j of road.jumps) {
      for (let k = 0; k < 5; k++) {
        const s = j.lip + 4 + k * 4.5;
        road.pointAt(s, p);
        const arc = Math.sin(((k + 0.5) / 5) * Math.PI) * (2 + j.height * 1.2);
        this.collectibles.push(this.placeAt(p, 0, 1.4 + arc, 'coin'));
      }
    }
    const crystals: CollectiblePlacement[] = [];
    const bigJumps = [...road.jumps].sort((a, b) => b.height - a.height);
    for (const j of bigJumps.slice(0, 2)) {
      road.pointAt(j.lip + 13, p);
      crystals.push(this.placeAt(p, 0, 4.2 + j.height * 1.4, 'crystal'));
    }
    // Shortcuts: coins along the corridor, crystal in the middle.
    for (const sc of this.shortcuts) {
      const len = Math.hypot(sc.bx - sc.ax, sc.bz - sc.az);
      const count = Math.floor(len / 10);
      for (let k = 1; k < count; k++) {
        const f = k / count;
        const x = sc.ax + (sc.bx - sc.ax) * f;
        const z = sc.az + (sc.bz - sc.az) * f;
        this.collectibles.push({ kind: 'coin', x, y: terrain.height(x, z) + 1.1, z });
      }
      const x = (sc.ax + sc.bx) / 2;
      const z = (sc.az + sc.bz) / 2;
      crystals.push({ kind: 'crystal', x, y: terrain.height(x, z) + 1.4, z });
    }
    // Remaining crystals hidden at the road edge on the outside of hairpins and at random spots.
    let guard = 0;
    while (crystals.length < this.track.collectibles.crystals && guard++ < 200) {
      const s = rng.range(80, this.finishS - 40);
      road.pointAt(s, p);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * (p.halfWidth + rng.range(4, 9));
      const c = this.placeAt(p, lat, 1.4, 'crystal');
      if (this.terrain.waterLevel(c.x, c.z) > c.y - 1.5) continue;
      crystals.push(c);
    }
    this.collectibles.push(...crystals.slice(0, this.track.collectibles.crystals));
  }

  private placeAt(
    p: { x: number; z: number; y: number; tx: number; tz: number },
    lateral: number,
    height: number,
    kind: 'coin' | 'crystal',
  ): CollectiblePlacement {
    const x = p.x + p.tz * lateral;
    const z = p.z - p.tx * lateral;
    const y = this.terrain.groundHeight(x, z, p.y + 3) + height;
    return { kind, x, y, z };
  }
}
