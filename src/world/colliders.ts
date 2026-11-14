import { Vector3 } from 'three';
import { config } from '../config';
import type { VehiclePhysics } from '../vehicle/physics';

export type ColliderKind = 'tree' | 'rock' | 'rail' | 'pillar' | 'hazard' | 'sign';

/** Vertical cylinder (trees, rocks, pillars) or capsule segment (rails, logs) in XZ. */
export interface Collider {
  id: number;
  kind: ColliderKind;
  ax: number;
  az: number;
  /** For segments: second end point. Equal to (ax, az) for circles. */
  bx: number;
  bz: number;
  radius: number;
  yMin: number;
  yMax: number;
  /** Dynamic colliders can move (hazards) and push the car. */
  dynamic: boolean;
  vx: number;
  vz: number;
  /** Count near misses for this collider only once per pass. */
  lastNearMiss: number;
  enabled: boolean;
  /** Owner reference (e.g. tree instance) for gameplay reactions; null when unused. */
  owner: unknown;
}

export interface ContactReport {
  /** Strongest normal impact speed this step (m/s). */
  impact: number;
  kind: ColliderKind | null;
  /** Closest clearance to any collider that was not touched (for near misses), -1 if none. */
  nearestClearance: number;
  nearestId: number;
}

const tmp = new Vector3();
const tmpR = new Vector3();
const fwd = new Vector3();

/**
 * Decides whether a contact breaks the collider (destructible trees). Returning true means the
 * handler dealt with it (speed loss, effects) and the contact is skipped.
 */
export type BreakHandler = (c: Collider, impactSpeed: number, car: VehiclePhysics) => boolean;

/** Static spatial hash of props plus a short list of dynamic colliders. */
export class CollisionWorld {
  breakHandler: BreakHandler | null = null;
  private readonly cell = 16;
  private readonly cells = new Map<number, Collider[]>();
  private readonly dynamic: Collider[] = [];
  private nextId = 1;
  readonly report: ContactReport = { impact: 0, kind: null, nearestClearance: -1, nearestId: -1 };
  private readonly candidates: Collider[] = [];
  private readonly seen = new Set<number>();
  count = 0;

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  addCircle(
    kind: ColliderKind,
    x: number,
    z: number,
    radius: number,
    yMin: number,
    yMax: number,
  ): Collider {
    return this.add({ kind, ax: x, az: z, bx: x, bz: z, radius, yMin, yMax });
  }

  addSegment(
    kind: ColliderKind,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    radius: number,
    yMin: number,
    yMax: number,
  ): Collider {
    return this.add({ kind, ax, az, bx, bz, radius, yMin, yMax });
  }

  addDynamic(
    kind: ColliderKind,
    x: number,
    z: number,
    radius: number,
    yMin: number,
    yMax: number,
  ): Collider {
    const c = this.make({ kind, ax: x, az: z, bx: x, bz: z, radius, yMin, yMax });
    c.dynamic = true;
    this.dynamic.push(c);
    return c;
  }

  removeDynamic(c: Collider): void {
    const i = this.dynamic.indexOf(c);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  /** Removes every dynamic collider of a kind (used when a system is disposed). */
  clearDynamic(kind: ColliderKind): void {
    for (let i = this.dynamic.length - 1; i >= 0; i--)
      if (this.dynamic[i].kind === kind) this.dynamic.splice(i, 1);
  }

  private make(
    p: Pick<Collider, 'kind' | 'ax' | 'az' | 'bx' | 'bz' | 'radius' | 'yMin' | 'yMax'>,
  ): Collider {
    return {
      ...p,
      id: this.nextId++,
      dynamic: false,
      vx: 0,
      vz: 0,
      lastNearMiss: -999,
      enabled: true,
      owner: null,
    };
  }

  private add(
    p: Pick<Collider, 'kind' | 'ax' | 'az' | 'bx' | 'bz' | 'radius' | 'yMin' | 'yMax'>,
  ): Collider {
    const c = this.make(p);
    const x0 = Math.floor((Math.min(c.ax, c.bx) - c.radius) / this.cell);
    const x1 = Math.floor((Math.max(c.ax, c.bx) + c.radius) / this.cell);
    const z0 = Math.floor((Math.min(c.az, c.bz) - c.radius) / this.cell);
    const z1 = Math.floor((Math.max(c.az, c.bz) + c.radius) / this.cell);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const k = this.key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
    }
    this.count++;
    return c;
  }

  /** Removes a static collider (props of an unloaded cell). */
  remove(c: Collider): void {
    const x0 = Math.floor((Math.min(c.ax, c.bx) - c.radius) / this.cell);
    const x1 = Math.floor((Math.max(c.ax, c.bx) + c.radius) / this.cell);
    const z0 = Math.floor((Math.min(c.az, c.bz) - c.radius) / this.cell);
    const z1 = Math.floor((Math.max(c.az, c.bz) + c.radius) / this.cell);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.cells.get(this.key(x, z));
        if (!list) continue;
        const i = list.indexOf(c);
        if (i >= 0) {
          list[i] = list[list.length - 1];
          list.pop();
        }
      }
    }
    this.count--;
  }

  /** Colliders whose bounds overlap a circle (used by placement and hazards). */
  query(x: number, z: number, r: number, out: Collider[]): Collider[] {
    out.length = 0;
    this.seen.clear();
    const x0 = Math.floor((x - r) / this.cell);
    const x1 = Math.floor((x + r) / this.cell);
    const z0 = Math.floor((z - r) / this.cell);
    const z1 = Math.floor((z + r) / this.cell);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const c of list) {
          if (this.seen.has(c.id) || !c.enabled) continue;
          this.seen.add(c.id);
          out.push(c);
        }
      }
    }
    for (const c of this.dynamic) if (c.enabled) out.push(c);
    return out;
  }

  /**
   * Resolves the car chassis (two circles along its axis) against nearby colliders.
   * Pushes the car out, removes the approaching velocity with restitution and adds a small
   * yaw kick. Fills `report` with impact and near-miss information.
   */
  resolveVehicle(car: VehiclePhysics, time: number): ContactReport {
    const rep = this.report;
    rep.impact = 0;
    rep.kind = null;
    rep.nearestClearance = -1;
    rep.nearestId = -1;
    const p = car.position;
    fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
    const len = car.def.chassis.length;
    const radius = car.def.chassis.width * 0.55;
    const off = len * 0.5 - radius;
    const near = config.gameplay.nearMissDistance;
    const list = this.query(p.x, p.z, len + near + 2, this.candidates);
    let bestClear = Infinity;
    let bestId = -1;
    const e = config.physics.propRestitution;
    for (let s = -1; s <= 1; s += 2) {
      const cx = p.x + fwd.x * off * s;
      const cz = p.z + fwd.z * off * s;
      for (const c of list) {
        if (p.y + 1 < c.yMin || p.y - 0.6 > c.yMax) continue;
        // Closest point on the collider's axis segment.
        const dx = c.bx - c.ax;
        const dz = c.bz - c.az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((cx - c.ax) * dx + (cz - c.az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = c.ax + dx * t;
        const pz = c.az + dz * t;
        let nx = cx - px;
        let nz = cz - pz;
        const dist = Math.hypot(nx, nz);
        const clearance = dist - radius - c.radius;
        if (clearance > 0) {
          if (clearance < bestClear) {
            bestClear = clearance;
            bestId = c.id;
          }
          continue;
        }
        if (dist < 1e-4) {
          nx = 1;
          nz = 0;
        } else {
          nx /= dist;
          nz /= dist;
        }
        if (c.kind === 'tree' && this.breakHandler) {
          tmpR.set(cx - p.x - nx * radius, 0, cz - p.z - nz * radius);
          car.pointVelocity(tmpR, tmp);
          const vIn = -((tmp.x - c.vx) * nx + (tmp.z - c.vz) * nz);
          if (vIn > 0 && this.breakHandler(c, vIn, car)) continue;
        }
        // Push out of penetration.
        const pen = -clearance;
        p.x += nx * pen;
        p.z += nz * pen;
        // Relative normal velocity at the contact.
        tmpR.set(cx - p.x - nx * radius, 0, cz - p.z - nz * radius);
        car.pointVelocity(tmpR, tmp);
        const vn = (tmp.x - c.vx) * nx + (tmp.z - c.vz) * nz;
        if (vn < 0) {
          const j = -(1 + e) * vn;
          car.velocity.x += nx * j;
          car.velocity.z += nz * j;
          // Tangential friction and a yaw kick depending on where we hit.
          const tx = -nz;
          const tz = nx;
          const vt = tmp.x * tx + tmp.z * tz;
          car.velocity.x -= tx * vt * 0.15;
          car.velocity.z -= tz * vt * 0.15;
          car.angularVelocity.y += s * (fwd.x * nz - fwd.z * nx) * Math.min(2.5, -vn * 0.12);
          if (-vn > rep.impact) {
            rep.impact = -vn;
            rep.kind = c.kind;
          }
        }
        // Dynamic colliders (boulders) shove the car.
        if (c.dynamic) {
          car.velocity.x += c.vx * 0.4;
          car.velocity.z += c.vz * 0.4;
        }
      }
    }
    if (bestClear < near && bestId >= 0) {
      rep.nearestClearance = bestClear;
      rep.nearestId = bestId;
      const c = this.findById(bestId, list);
      if (c && time - c.lastNearMiss < 4)
        rep.nearestId = -1; // already counted recently
      else if (c) c.lastNearMiss = time;
    }
    return rep;
  }

  private findById(id: number, list: Collider[]): Collider | null {
    for (const c of list) if (c.id === id) return c;
    return null;
  }

  clear(): void {
    this.cells.clear();
    this.dynamic.length = 0;
    this.count = 0;
  }
}
