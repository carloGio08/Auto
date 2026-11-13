import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { config, type QualityPreset } from '../config';
import { Rng } from '../math/rng';
import { Simplex2 } from '../math/noise';
import { smoothstep } from '../math/util';
import { createRoadQuery } from '../terrain/road';
import { distanceToSegment } from '../terrain/terrain';
import type { Course } from '../terrain/course';
import type { CollisionWorld } from './colliders';
import {
  bushGeometry,
  logGeometry,
  pineGeometry,
  rockGeometry,
  roundTreeGeometry,
} from './propGeometry';

interface PropType {
  id: string;
  geometry: BufferGeometry;
  castShadow: boolean;
}

interface Instance {
  type: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  tilt: number;
}

interface Cell {
  cx: number;
  cz: number;
  meshes: InstancedMesh[];
}

/**
 * Procedural vegetation and rocks placed with seeded jittered grids, rendered as one
 * InstancedMesh per prop type per spatial cell so frustum and distance culling work.
 */
export class Props {
  readonly group = new Group();
  private readonly types: PropType[] = [];
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly cells: Cell[] = [];
  instanceCount = 0;

  constructor(
    private readonly course: Course,
    private readonly colliders: CollisionWorld,
    private readonly preset: QualityPreset,
  ) {
    this.group.name = 'props';
    const snowy = course.track.defaultWeather === 'snow';
    this.types = [
      { id: 'pine0', geometry: pineGeometry(0), castShadow: true },
      { id: 'pine1', geometry: pineGeometry(1), castShadow: true },
      { id: 'pine2', geometry: pineGeometry(2), castShadow: true },
      { id: 'pineSnow', geometry: pineGeometry(3, true), castShadow: true },
      { id: 'round0', geometry: roundTreeGeometry(0), castShadow: true },
      { id: 'round1', geometry: roundTreeGeometry(1), castShadow: true },
      { id: 'bush0', geometry: bushGeometry(0), castShadow: false },
      { id: 'bush1', geometry: bushGeometry(1), castShadow: false },
      { id: 'rock0', geometry: rockGeometry(0), castShadow: true },
      { id: 'rock1', geometry: rockGeometry(1, '#7c776f'), castShadow: true },
      { id: 'rock2', geometry: rockGeometry(2, snowy ? '#9a9690' : '#857f76'), castShadow: true },
      { id: 'log', geometry: logGeometry(), castShadow: true },
    ];
  }

  private typeIndex(id: string): number {
    return this.types.findIndex((t) => t.id === id);
  }

  /** Generates placements and colliders, then builds the instanced meshes. */
  build(): void {
    const instances = this.place();
    const size = config.world.propCellSize;
    const byCell = new Map<string, Instance[]>();
    for (const inst of instances) {
      const key = `${Math.floor(inst.x / size)},${Math.floor(inst.z / size)}`;
      let list = byCell.get(key);
      if (!list) byCell.set(key, (list = []));
      list.push(inst);
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const qTilt = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const yAxis = new Vector3(0, 1, 0);
    const xAxis = new Vector3(1, 0, 0);
    for (const [key, list] of byCell) {
      const [cx, cz] = key.split(',').map(Number);
      const cell: Cell = { cx: (cx + 0.5) * size, cz: (cz + 0.5) * size, meshes: [] };
      for (let t = 0; t < this.types.length; t++) {
        const items = list.filter((i) => i.type === t);
        if (!items.length) continue;
        const mesh = new InstancedMesh(this.types[t].geometry, this.material, items.length);
        items.forEach((it, i) => {
          q.setFromAxisAngle(yAxis, it.rot);
          if (it.tilt) q.multiply(qTilt.setFromAxisAngle(xAxis, it.tilt));
          s.setScalar(it.scale);
          if (this.types[t].id.startsWith('rock')) s.set(it.scale * 1.1, it.scale * 0.9, it.scale);
          p.set(it.x, it.y, it.z);
          m.compose(p, q, s);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = this.types[t].castShadow;
        mesh.userData.castShadow = this.types[t].castShadow;
        mesh.receiveShadow = false;
        mesh.matrixAutoUpdate = false;
        cell.meshes.push(mesh);
        this.group.add(mesh);
      }
      this.cells.push(cell);
    }
    this.instanceCount = instances.length;
  }

  private place(): Instance[] {
    const course = this.course;
    const terrain = course.terrain;
    const road = course.road;
    const def = course.track;
    const rng = new Rng(def.seed ^ 0x7ee5);
    const forest = new Simplex2(def.seed ^ 0xf0e5);
    const q = createRoadQuery();
    const out: Instance[] = [];
    const density = this.preset.propDensity;
    const snowLine = course.mountain.def.snowLine;
    const lake = course.mountain.def.lakeLevel;
    const b = road.bounds;
    const minX = b.minX - 300;
    const maxX = b.maxX + 300;
    const minZ = b.minZ - 220;
    const maxZ = b.maxZ + 260;
    const structures = this.structureKeepouts();

    const clearOf = (x: number, z: number, margin: number): boolean => {
      road.query(x, z, q);
      if (q.found && q.distance < q.halfWidth + margin) return false;
      for (const sc of course.shortcuts)
        if (distanceToSegment(x, z, sc.ax, sc.az, sc.bx, sc.bz) < sc.halfWidth + 1) return false;
      for (const k of structures) if (Math.hypot(x - k[0], z - k[1]) < k[2]) return false;
      return true;
    };
    const roadDistance = (x: number, z: number): number => {
      road.query(x, z, q);
      return q.found ? q.distance : 999;
    };

    // Trees.
    const treeStep = 7.5;
    for (let z = minZ; z < maxZ; z += treeStep) {
      for (let x = minX; x < maxX; x += treeStep) {
        const px = x + rng.range(0, treeStep);
        const pz = z + rng.range(0, treeStep);
        const far = roadDistance(px, pz);
        const farFade = 1 - smoothstep(170, 300, far);
        if (farFade <= 0) continue;
        const h = terrain.height(px, pz);
        if (h < lake + 2.5 || terrain.waterLevel(px, pz) > h - 0.3) continue;
        if (h > snowLine + 45) continue;
        const nrm = terrain.normal(px, pz, tmpN);
        if (nrm.y < 0.78) continue;
        const forestNoise = 0.5 + 0.5 * forest.fbm(px / 160, pz / 160, 3);
        const altitude = 1 - smoothstep(snowLine - 70, snowLine + 40, h);
        const nearRoad = smoothstep(8, 22, far);
        const p =
          forestNoise *
          forestNoise *
          1.25 *
          altitude *
          def.props.trees *
          density *
          farFade *
          (0.35 + 0.65 * nearRoad);
        if (rng.next() > p) continue;
        if (!clearOf(px, pz, 3.5)) continue;
        const high = h > snowLine - 50;
        let type: string;
        if (high) type = rng.chance(0.55) ? 'pineSnow' : `pine${rng.int(0, 2)}`;
        else if (h < lake + 60 && rng.chance(0.45)) type = `round${rng.int(0, 1)}`;
        else type = `pine${rng.int(0, 2)}`;
        const scale = rng.range(0.75, 1.3);
        out.push({
          type: this.typeIndex(type),
          x: px,
          y: h - 0.2,
          z: pz,
          scale,
          rot: rng.range(0, Math.PI * 2),
          tilt: 0,
        });
        if (far < 120) this.colliders.addCircle('tree', px, pz, 0.35 * scale, h - 1, h + 9 * scale);
      }
    }

    // Bushes (decorative, no collision).
    const bushStep = 9;
    for (let z = minZ; z < maxZ; z += bushStep) {
      for (let x = minX; x < maxX; x += bushStep) {
        const px = x + rng.range(0, bushStep);
        const pz = z + rng.range(0, bushStep);
        const far = roadDistance(px, pz);
        if (far > 160) continue;
        const h = terrain.height(px, pz);
        if (h < lake + 1.5 || h > snowLine - 10) continue;
        if (rng.next() > 0.3 * def.props.bushes * density) continue;
        if (!clearOf(px, pz, 1.5)) continue;
        out.push({
          type: this.typeIndex(`bush${rng.int(0, 1)}`),
          x: px,
          y: h - 0.1,
          z: pz,
          scale: rng.range(0.7, 1.4),
          rot: rng.range(0, 6.28),
          tilt: 0,
        });
      }
    }

    // Rocks: more on steep ground, boulders lining shortcuts.
    const rockStep = 12;
    for (let z = minZ; z < maxZ; z += rockStep) {
      for (let x = minX; x < maxX; x += rockStep) {
        const px = x + rng.range(0, rockStep);
        const pz = z + rng.range(0, rockStep);
        const far = roadDistance(px, pz);
        if (far > 220) continue;
        const h = terrain.height(px, pz);
        if (terrain.waterLevel(px, pz) > h + 0.5) continue;
        const nrm = terrain.normal(px, pz, tmpN);
        const steep = 1 - smoothstep(0.75, 0.95, nrm.y);
        const p = (0.07 + steep * 0.35) * def.props.rocks * density;
        if (rng.next() > p) continue;
        if (!clearOf(px, pz, 2.5)) continue;
        const scale = rng.range(0.4, 2.2) * (1 + steep * 0.6);
        out.push({
          type: this.typeIndex(`rock${rng.int(0, 2)}`),
          x: px,
          y: h - 0.25 * scale,
          z: pz,
          scale,
          rot: rng.range(0, 6.28),
          tilt: rng.range(-0.2, 0.2),
        });
        if (scale > 0.65 && far < 120)
          this.colliders.addCircle('rock', px, pz, 0.95 * scale, h - 1, h + 1.2 * scale);
      }
    }
    for (const sc of course.shortcuts) {
      const len = Math.hypot(sc.bx - sc.ax, sc.bz - sc.az);
      const dx = (sc.bx - sc.ax) / len;
      const dz = (sc.bz - sc.az) / len;
      for (let d = 8; d < len - 8; d += rng.range(5, 9)) {
        // Rocks along both edges and a few right in the line to dodge.
        for (const side of [-1, 1]) {
          if (!rng.chance(0.7)) continue;
          const off = side * (sc.halfWidth + rng.range(0.5, 2.5));
          const px = sc.ax + dx * d + dz * off;
          const pz = sc.az + dz * d - dx * off;
          const h = terrain.height(px, pz);
          const scale = rng.range(0.8, 1.6);
          out.push({
            type: this.typeIndex(`rock${rng.int(0, 2)}`),
            x: px,
            y: h - 0.2 * scale,
            z: pz,
            scale,
            rot: rng.range(0, 6.28),
            tilt: 0,
          });
          this.colliders.addCircle('rock', px, pz, 0.95 * scale, h - 1, h + 1.2 * scale);
        }
        if (rng.chance(0.18)) {
          const off = rng.range(-sc.halfWidth * 0.6, sc.halfWidth * 0.6);
          const px = sc.ax + dx * d + dz * off;
          const pz = sc.az + dz * d - dx * off;
          if (sc.kickers.some((k) => Math.hypot(k.x - px, k.z - pz) < 12)) continue;
          const h = terrain.height(px, pz);
          const scale = rng.range(0.7, 1.1);
          out.push({
            type: this.typeIndex('rock1'),
            x: px,
            y: h - 0.2 * scale,
            z: pz,
            scale,
            rot: rng.range(0, 6.28),
            tilt: 0,
          });
          this.colliders.addCircle('rock', px, pz, 0.95 * scale, h - 1, h + 1.2 * scale);
        }
      }
    }
    // Decorative logs piled near the road.
    for (let i = 0; i < 14; i++) {
      const s = rng.range(80, road.length - 80);
      const pt = road.pointAt(s, tmpP);
      const side = rng.chance(0.5) ? 1 : -1;
      const off = side * (pt.halfWidth + rng.range(5, 9));
      const px = pt.x + pt.tz * off;
      const pz = pt.z - pt.tx * off;
      if (!clearOf(px, pz, 4)) continue;
      const h = terrain.height(px, pz);
      const rot = Math.atan2(pt.tx, pt.tz) + rng.range(-0.3, 0.3);
      out.push({ type: this.typeIndex('log'), x: px, y: h - 0.15, z: pz, scale: 1, rot, tilt: 0 });
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      this.colliders.addSegment(
        'rock',
        px - c * 3.4,
        pz + sn * 3.4,
        px + c * 3.4,
        pz - sn * 3.4,
        0.45,
        h - 1,
        h + 1,
      );
    }
    return out;
  }

  /** Areas that must stay free of props (arch, gates, signs). */
  private structureKeepouts(): [number, number, number][] {
    const course = this.course;
    const out: [number, number, number][] = [];
    const pt = { x: 0, y: 0, z: 0, tx: 0, tz: 1, halfWidth: 5, s: 0, index: 0 };
    if (course.archS !== null) {
      course.road.pointAt(course.archS, pt);
      out.push([pt.x, pt.z, 16]);
    }
    for (const s of [course.startS, course.finishS, ...course.checkpoints]) {
      course.road.pointAt(s, pt);
      out.push([pt.x, pt.z, 12]);
    }
    return out;
  }

  /** Distance culling per cell. */
  update(camX: number, camZ: number, distance = this.preset.propDistance): void {
    const max = distance + config.world.propCellSize * 0.7;
    for (const c of this.cells) {
      const visible = Math.hypot(c.cx - camX, c.cz - camZ) < max;
      for (const m of c.meshes) m.visible = visible;
    }
  }

  setShadows(enabled: boolean): void {
    for (const c of this.cells)
      for (const m of c.meshes) m.castShadow = enabled && m.userData.castShadow === true;
  }

  dispose(): void {
    for (const c of this.cells) c.meshes.forEach((m) => m.dispose());
    this.types.forEach((t) => t.geometry.dispose());
    this.material.dispose();
    this.group.removeFromParent();
  }
}

const tmpN = new Vector3();
const tmpP = { x: 0, y: 0, z: 0, tx: 0, tz: 1, halfWidth: 5, s: 0, index: 0 };
