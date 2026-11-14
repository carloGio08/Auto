import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { ResolvedPalette } from '../data/palette';
import { Rng } from '../math/rng';
import { createRoadPoint } from '../terrain/road';
import type { Course, FurniturePlacement } from '../terrain/course';
import type { CollisionWorld } from './colliders';
import { PropGeometry } from './propGeometry';

const q = new Quaternion();
const s = new Vector3();
const p = new Vector3();
const yAxis = new Vector3(0, 1, 0);

/**
 * Static trail furniture placed by the course: painted waymark posts, cairns, signs pointing
 * to the base, wooden fences on hairpins, footbridges over streams, the village at the base
 * and the summit overlook. Each kind is a single InstancedMesh.
 */
export class Structures {
  readonly group = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly geometries: BufferGeometry[] = [];
  private readonly geo: PropGeometry;

  constructor(
    private readonly course: Course,
    private readonly colliders: CollisionWorld,
    palette: ResolvedPalette,
  ) {
    this.group.name = 'structures';
    this.geo = new PropGeometry(palette);
  }

  private instanced(geo: BufferGeometry, matrices: Matrix4[], shadows = true): void {
    this.geometries.push(geo);
    if (!matrices.length) return;
    const mesh = new InstancedMesh(geo, this.material, matrices.length);
    matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private at(f: FurniturePlacement, heading: number, scale = 1): Matrix4 {
    return new Matrix4().compose(
      p.set(f.x, f.y, f.z),
      q.setFromAxisAngle(yAxis, heading),
      s.setScalar(scale),
    );
  }

  build(): void {
    const c = this.course;
    this.instanced(
      this.geo.waymark(),
      c.waymarks.map((w) => this.at(w, w.heading)),
    );
    this.instanced(
      this.geo.cairn(),
      c.cairns.map((w, i) => this.at(w, w.heading + i, 0.9 + (i % 3) * 0.15)),
    );
    // Signs: the board's arrow points along +Z, rotate it towards the base.
    this.instanced(
      this.geo.sign(),
      c.signs.map((sg) => this.at(sg, sg.arrow)),
    );
    for (const sg of c.signs)
      this.colliders.addCircle('sign', sg.x, sg.z, 0.12, sg.y - 1, sg.y + 2.4);
    for (const w of c.waymarks) this.colliders.addCircle('sign', w.x, w.z, 0.1, w.y - 1, w.y + 1.3);
    this.buildFences();
    this.buildBridges();
    this.buildVillage();
    this.buildOverlook();
  }

  private buildFences(): void {
    const c = this.course;
    const road = c.road;
    const pt = createRoadPoint();
    const list: Matrix4[] = [];
    for (const f of c.fences) {
      for (let sv = f.from; sv < f.to - 0.5; sv += 4) {
        road.pointAt(sv, pt, f.trail);
        const x0 = pt.x + pt.tz * f.lateral;
        const z0 = pt.z - pt.tx * f.lateral;
        road.pointAt(Math.min(sv + 4, f.to), pt, f.trail);
        const x1 = pt.x + pt.tz * f.lateral;
        const z1 = pt.z - pt.tx * f.lateral;
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.5) continue;
        const y0 = c.terrain.groundHeight(x0, z0, pt.y + 3);
        q.setFromAxisAngle(yAxis, Math.atan2(-(z1 - z0), x1 - x0));
        list.push(new Matrix4().compose(p.set(x0, y0 - 0.05, z0), q, s.set(len / 4, 1, 1)));
        this.colliders.addSegment('rail', x0, z0, x1, z1, 0.12, y0 - 1, y0 + 1);
      }
    }
    this.instanced(this.geo.fence(), list);
  }

  private buildBridges(): void {
    const road = this.course.road;
    const planks: Matrix4[] = [];
    const beams: Matrix4[] = [];
    const rails: Matrix4[] = [];
    for (const b of road.bridges) {
      const tr = road.trails[b.trail];
      for (let i = Math.round(b.from / road.spacing); i < Math.round(b.to / road.spacing); i++) {
        const g = tr.start + i;
        const x0 = road.x[g];
        const z0 = road.z[g];
        const x1 = road.x[g + 1];
        const z1 = road.z[g + 1];
        const y = (road.y[g] + road.y[g + 1]) / 2;
        const heading = Math.atan2(x1 - x0, z1 - z0);
        const hw = road.halfWidth[g] + 0.3;
        const len = Math.hypot(x1 - x0, z1 - z0);
        q.setFromAxisAngle(yAxis, heading);
        planks.push(
          new Matrix4().compose(
            p.set((x0 + x1) / 2, y - 0.12, (z0 + z1) / 2),
            q,
            s.set(hw * 2, 1, len + 0.05),
          ),
        );
        // Railings on both sides (fence segments along the deck).
        for (const side of [-1, 1]) {
          const rx = x0 + Math.cos(heading) * side * hw;
          const rz = z0 - Math.sin(heading) * side * hw;
          rails.push(
            new Matrix4().compose(
              p.set(rx, y, rz),
              new Quaternion().setFromAxisAngle(yAxis, heading - Math.PI / 2),
              s.set(len / 4, 1, 1),
            ),
          );
          const rx1 = x1 + Math.cos(heading) * side * hw;
          const rz1 = z1 - Math.sin(heading) * side * hw;
          this.colliders.addSegment('rail', rx, rz, rx1, rz1, 0.12, y - 1, y + 1.2);
        }
        if (i % 3 === 0) {
          for (const side of [-1, 1]) {
            const bx = x0 + Math.cos(heading) * side * (hw - 0.2);
            const bz = z0 - Math.sin(heading) * side * (hw - 0.2);
            const ground = this.course.terrain.height(bx, bz);
            const h = Math.max(0.6, y - ground + 0.8);
            beams.push(
              new Matrix4().compose(p.set(bx, y - 0.3 - h / 2, bz), q, s.set(0.35, h, 0.35)),
            );
          }
        }
      }
    }
    this.instanced(this.geo.plank(), planks);
    this.instanced(this.geo.beam(), beams);
    this.instanced(this.geo.fence(), rails);
  }

  /** A handful of houses around the arrival zone at the lake. */
  private buildVillage(): void {
    const c = this.course;
    const rng = new Rng(c.def.seed ^ 0x7111);
    const houses: Matrix4[][] = [[], [], []];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = c.base.radius + rng.range(12, 40);
      const x = c.base.x + Math.sin(a) * r;
      const z = c.base.z + Math.cos(a) * r;
      const y = c.terrain.height(x, z);
      if (c.terrain.waterLevel(x, z) > y - 0.5) continue;
      const rq = c.terrain.lastQuery;
      if (rq.found && rq.distance < rq.halfWidth + 6) continue;
      houses[k % 3].push(
        new Matrix4().compose(
          p.set(x, y - 0.3, z),
          q.setFromAxisAngle(yAxis, a + Math.PI),
          s.setScalar(1),
        ),
      );
      this.colliders.addCircle('pillar', x, z, 3.6, y - 1, y + 6);
    }
    houses.forEach((list, v) => this.instanced(this.geo.house(v), list));
  }

  /** Summit overlook: a ring of cairns and waymarks at the edge of the plateau. */
  private buildOverlook(): void {
    const c = this.course;
    const cairns: Matrix4[] = [];
    for (let k = 0; k < 5; k++) {
      const a = c.start.heading + Math.PI + (k - 2) * 0.35;
      const x = c.start.x + Math.sin(a) * 14;
      const z = c.start.z + Math.cos(a) * 14;
      const y = c.terrain.height(x, z);
      cairns.push(
        new Matrix4().compose(p.set(x, y - 0.1, z), q.setFromAxisAngle(yAxis, a), s.setScalar(1.3)),
      );
      this.colliders.addCircle('rock', x, z, 0.7, y - 1, y + 2);
    }
    this.instanced(this.geo.cairn(), cairns);
  }

  dispose(): void {
    this.group.children.forEach((o) => (o as InstancedMesh).dispose());
    this.geometries.forEach((g) => g.dispose());
    this.material.dispose();
    this.group.removeFromParent();
  }
}
