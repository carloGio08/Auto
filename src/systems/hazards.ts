import {
  CircleGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';
import { hazards as hazardDefs } from '../data/hazards';
import type { HazardPlacement } from '../data/types';
import { createRoadPoint } from '../terrain/road';
import type { SurfacePatch } from '../terrain/terrain';
import type { Collider } from '../world/colliders';
import { PropGeometry } from '../world/propGeometry';
import { BaseSystem } from './system';

interface Rolling {
  mesh: Mesh;
  collider: Collider;
  pos: Vector3;
  vel: Vector3;
  radius: number;
  life: number;
  falling: boolean;
}

const n = new Vector3();

/**
 * Dynamic dangers along the main trail: boulders rolling down across it, rockslides falling
 * onto it, mud pools and ice patches (surface overrides).
 */
export class HazardsSystem extends BaseSystem {
  readonly id = 'hazards' as const;
  private readonly group = new Group();
  private readonly pendingTriggers: { placement: HazardPlacement; s: number; fired: boolean }[] =
    [];
  private readonly rolling: Rolling[] = [];
  private readonly patches: SurfacePatch[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly rockMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private mudMat = new MeshLambertMaterial({
    color: '#4e3a28',
    transparent: true,
    opacity: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  private iceMat = new MeshLambertMaterial({
    color: '#d9f1ff',
    transparent: true,
    opacity: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  private boulderGeo!: BufferGeometry;
  private smallRockGeo!: BufferGeometry;

  protected setup(): void {
    const { course, world } = this.session;
    const geo = new PropGeometry(world.palette);
    this.boulderGeo = this.keep(geo.rock(1));
    this.smallRockGeo = this.keep(geo.rock(2));
    this.mudMat.color.copy(world.palette.mud[1]);
    this.iceMat.color.copy(world.palette.snowShade[2]);
    const p = createRoadPoint();
    for (const h of course.def.hazards) {
      const s = h.at * course.road.length;
      if (course.road.isBridgeAt(s, 15)) continue;
      const def = hazardDefs[h.kind];
      course.road.pointAt(s, p);
      if (h.kind === 'mudPool' || h.kind === 'icePatch') {
        const patch: SurfacePatch = { x: p.x, z: p.z, radius: def.radius, surface: def.surface! };
        course.terrain.patches.push(patch);
        this.patches.push(patch);
        const decal = new Mesh(
          this.keep(new CircleGeometry(def.radius, 14).rotateX(-Math.PI / 2)),
          h.kind === 'mudPool' ? this.mudMat : this.iceMat,
        );
        decal.position.set(p.x, p.y + 0.12, p.z);
        decal.receiveShadow = true;
        this.group.add(decal);
      } else {
        this.pendingTriggers.push({ placement: h, s, fired: false });
      }
    }
    world.scene.add(this.group);
  }

  private keep<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private spawnRock(
    x: number,
    y: number,
    z: number,
    radius: number,
    vel: Vector3,
    falling: boolean,
    big: boolean,
  ): void {
    const mesh = new Mesh(big ? this.boulderGeo : this.smallRockGeo, this.rockMat);
    mesh.scale.setScalar(radius);
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const collider = this.session.world.colliders.addDynamic(
      'hazard',
      x,
      z,
      radius * 0.95,
      y - radius,
      y + radius,
    );
    this.rolling.push({
      mesh,
      collider,
      pos: new Vector3(x, y, z),
      vel: vel.clone(),
      radius,
      life: 14,
      falling,
    });
  }

  private trigger(t: { placement: HazardPlacement; s: number }): void {
    const { course, events } = this.session;
    const p = course.road.pointAt(t.s, createRoadPoint());
    const terrain = course.terrain;
    // Uphill side of the road.
    const hl = terrain.height(p.x + p.tz * 30, p.z - p.tx * 30);
    const hr = terrain.height(p.x - p.tz * 30, p.z + p.tx * 30);
    const side = hl > hr ? 1 : -1;
    if (t.placement.kind === 'boulder') {
      const off = side * 34;
      const x = p.x + p.tz * off;
      const z = p.z - p.tx * off;
      this.spawnRock(
        x,
        terrain.height(x, z) + 1.8,
        z,
        1.8,
        new Vector3(-p.tz * side * 6, 0, p.tx * side * 6),
        false,
        true,
      );
      events.emit('ui:toast', { text: 'toast.hazard.boulder', tone: 'bad' });
    } else {
      for (let i = 0; i < 7; i++) {
        const along = (i - 3) * 3.2 + Math.random() * 2;
        const lat = side * (p.halfWidth * 0.2 + Math.random() * p.halfWidth * 1.2);
        const x = p.x + p.tx * along + p.tz * lat;
        const z = p.z + p.tz * along - p.tx * lat;
        const r = 0.6 + Math.random() * 0.5;
        this.spawnRock(
          x,
          terrain.height(x, z) + 14 + i * 2.5,
          z,
          r,
          new Vector3(-p.tz * side * 2, -2, p.tx * side * 2),
          true,
          false,
        );
      }
      events.emit('ui:toast', { text: 'toast.hazard.rockslide', tone: 'bad' });
      events.emit('fx:shake', { amount: 0.4 });
    }
    events.emit('hazard:triggered', { kind: t.placement.kind });
  }

  fixedUpdate(dt: number): void {
    const s = this.session;
    if (s.phase === 'running') {
      for (const t of this.pendingTriggers) {
        if (t.fired) continue;
        const dist = hazardDefs[t.placement.kind].triggerDistance;
        if (s.progressS > t.s - dist && s.progressS < t.s) {
          t.fired = true;
          this.trigger(t);
        }
      }
    }
    const terrain = s.course.terrain;
    for (let i = this.rolling.length - 1; i >= 0; i--) {
      const r = this.rolling[i];
      r.life -= dt;
      const ground = terrain.height(r.pos.x, r.pos.z) + r.radius * 0.8;
      if (r.pos.y > ground + 0.05) {
        r.vel.y -= 15 * dt;
      } else {
        // Roll down the slope: gravity component along the terrain plus rolling friction.
        terrain.normal(r.pos.x, r.pos.z, n);
        r.vel.x += n.x * 15 * dt * 1.4;
        r.vel.z += n.z * 15 * dt * 1.4;
        r.vel.multiplyScalar(1 - dt * (r.falling ? 2.5 : 0.25));
        if (r.vel.y < 0) r.vel.y = -r.vel.y * 0.25;
        r.pos.y = ground;
      }
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      const speed = Math.hypot(r.vel.x, r.vel.z);
      r.mesh.rotation.x += (speed / r.radius) * dt;
      r.collider.ax = r.collider.bx = r.pos.x;
      r.collider.az = r.collider.bz = r.pos.z;
      r.collider.yMin = r.pos.y - r.radius;
      r.collider.yMax = r.pos.y + r.radius;
      r.collider.vx = r.vel.x;
      r.collider.vz = r.vel.z;
      if (r.life <= 0 || r.pos.y < terrain.mountain.def.lake.level - 5) this.removeRock(i);
    }
  }

  private removeRock(i: number): void {
    const r = this.rolling[i];
    this.session.world.colliders.removeDynamic(r.collider);
    r.mesh.removeFromParent();
    this.rolling.splice(i, 1);
  }

  protected override teardown(): void {
    while (this.rolling.length) this.removeRock(this.rolling.length - 1);
    const patches = this.session.course.terrain.patches;
    for (const p of this.patches) {
      const i = patches.indexOf(p);
      if (i >= 0) patches.splice(i, 1);
    }
    // Static hazard colliders (logs) were added as dynamic so they can be removed here.
    this.session.world.colliders.clearDynamic('hazard');
    this.geometries.forEach((g) => g.dispose());
    this.rockMat.dispose();
    this.mudMat.dispose();
    this.iceMat.dispose();
    this.group.removeFromParent();
  }
}
