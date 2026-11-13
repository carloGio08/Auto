import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three';
import { createRoadPoint } from '../terrain/road';
import type { Course, SignPlacement } from '../terrain/course';
import type { CollisionWorld } from './colliders';
import { fenceGeometry, guardrailGeometry } from './propGeometry';
import { Rng } from '../math/rng';

function signTexture(kind: SignPlacement['kind']): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  if (kind === 'chevronLeft' || kind === 'chevronRight') {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#16181c';
    const dir = kind === 'chevronLeft' ? -1 : 1;
    for (let i = 0; i < 2; i++) {
      const cx = 64 + (i - 0.5) * 40 * dir;
      ctx.beginPath();
      ctx.moveTo(cx - 14 * dir, 24);
      ctx.lineTo(cx + 14 * dir, 64);
      ctx.lineTo(cx - 14 * dir, 104);
      ctx.lineTo(cx - 30 * dir, 104);
      ctx.lineTo(cx - 2 * dir, 64);
      ctx.lineTo(cx - 30 * dir, 24);
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === 'shortcut') {
    ctx.fillStyle = '#1f8a4c';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(30, 100);
    ctx.lineTo(30, 60);
    ctx.quadraticCurveTo(30, 34, 64, 34);
    ctx.lineTo(96, 34);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(110, 34);
    ctx.lineTo(86, 14);
    ctx.lineTo(86, 54);
    ctx.fill();
  } else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#d7262b';
    ctx.beginPath();
    ctx.moveTo(64, 8);
    ctx.lineTo(122, 116);
    ctx.lineTo(6, 116);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(64, 32);
    ctx.lineTo(102, 104);
    ctx.lineTo(26, 104);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#16181c';
    ctx.fillRect(34, 84, 60, 8);
    ctx.beginPath();
    ctx.moveTo(40, 84);
    ctx.lineTo(64, 56);
    ctx.lineTo(70, 62);
    ctx.lineTo(52, 84);
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Road furniture and landmarks: guardrails on hairpins, bridge railings, fences, warning
 * signs, start and finish gates and the rock arch. Registers colliders for solid parts.
 */
export class Structures {
  readonly group = new Group();
  private readonly textures: Texture[] = [];

  constructor(
    private readonly course: Course,
    private readonly colliders: CollisionWorld,
    private readonly checkerTexture: Texture,
  ) {
    this.group.name = 'structures';
  }

  build(): void {
    this.buildRails();
    this.buildSigns();
    this.buildGates();
    this.buildArch();
  }

  private buildRails(): void {
    const road = this.course.road;
    const terrain = this.course.terrain;
    const p = createRoadPoint();
    const kinds = {
      guardrail: guardrailGeometry(),
      fence: fenceGeometry(),
      bridge: guardrailGeometry(),
    };
    const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const entries: Record<string, Matrix4[]> = { guardrail: [], fence: [], bridge: [] };
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const rail of this.course.rails) {
      for (let s = rail.from; s < rail.to - 0.5; s += 4) {
        road.pointAt(s, p);
        const x0 = p.x + p.tz * rail.lateral;
        const z0 = p.z - p.tx * rail.lateral;
        road.pointAt(Math.min(s + 4, rail.to), p);
        const x1 = p.x + p.tz * rail.lateral;
        const z1 = p.z - p.tx * rail.lateral;
        const yRef = p.y + 2;
        const y0 = rail.kind === 'bridge' ? p.y : terrain.groundHeight(x0, z0, yRef);
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.5) continue;
        // Segment geometry runs along +X: rotate so +X points from p0 to p1.
        q.setFromAxisAngle(up, Math.atan2(-(z1 - z0), x1 - x0));
        m.compose(new Vector3(x0, y0 - 0.05, z0), q, new Vector3(len / 4, 1, 1));
        entries[rail.kind].push(m.clone());
        this.colliders.addSegment(
          rail.kind === 'fence' ? 'rail' : 'rail',
          x0,
          z0,
          x1,
          z1,
          0.15,
          y0 - 1,
          y0 + 1.1,
        );
      }
    }
    for (const [kind, list] of Object.entries(entries)) {
      if (!list.length) continue;
      const mesh = new InstancedMesh(kinds[kind as keyof typeof kinds], mat, list.length);
      list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  private buildSigns(): void {
    const road = this.course.road;
    const terrain = this.course.terrain;
    const p = createRoadPoint();
    const postGeo = new CylinderGeometry(0.06, 0.06, 2.2, 5);
    postGeo.translate(0, 1.1, 0);
    const postMat = new MeshLambertMaterial({ color: '#8a8f96' });
    const boardGeo = new PlaneGeometry(1.1, 1.1);
    const mats = new Map<string, MeshLambertMaterial>();
    for (const sign of this.course.signs) {
      road.pointAt(sign.s, p);
      const x = p.x + p.tz * sign.lateral;
      const z = p.z - p.tx * sign.lateral;
      const y = terrain.groundHeight(x, z, p.y + 2);
      let mat = mats.get(sign.kind);
      if (!mat) {
        const tex = signTexture(sign.kind);
        this.textures.push(tex);
        mat = new MeshLambertMaterial({ map: tex, side: DoubleSide });
        mats.set(sign.kind, mat);
      }
      const post = new Mesh(postGeo, postMat);
      post.position.set(x, y, z);
      post.castShadow = true;
      const board = new Mesh(boardGeo, mat);
      board.position.set(0, 2.25, 0);
      // Face oncoming traffic (towards -tangent).
      post.rotation.y = Math.atan2(-p.tx, -p.tz);
      post.add(board);
      this.group.add(post);
      this.colliders.addCircle('sign', x, z, 0.12, y - 1, y + 2.5);
    }
  }

  private gate(s: number, color: string, banner: boolean): void {
    const road = this.course.road;
    const terrain = this.course.terrain;
    const p = road.pointAt(s, createRoadPoint());
    const g = new Group();
    const hw = p.halfWidth + 1.4;
    const poleGeo = new BoxGeometry(0.5, 6, 0.5);
    poleGeo.translate(0, 3, 0);
    const poleMat = new MeshLambertMaterial({ color });
    for (const side of [-1, 1]) {
      const x = p.x + p.tz * side * hw;
      const z = p.z - p.tx * side * hw;
      const y = terrain.groundHeight(x, z, p.y + 2);
      const pole = new Mesh(poleGeo, poleMat);
      pole.position.set(x, y - 0.2, z);
      pole.castShadow = true;
      g.add(pole);
      this.colliders.addCircle('pillar', x, z, 0.4, y - 1, y + 6);
    }
    if (banner) {
      const bannerGeo = new BoxGeometry(hw * 2 + 0.5, 1.4, 0.2);
      const bannerMesh = new Mesh(bannerGeo, new MeshLambertMaterial({ map: this.checkerTexture }));
      bannerMesh.position.set(p.x, p.y + 6.2, p.z);
      bannerMesh.rotation.y = Math.atan2(p.tx, p.tz);
      bannerMesh.castShadow = true;
      g.add(bannerMesh);
    }
    this.group.add(g);
  }

  private buildGates(): void {
    this.gate(this.course.startS + 4, '#e8452c', true);
    this.gate(this.course.finishS, '#1f9e6e', true);
  }

  private buildArch(): void {
    const s = this.course.archS;
    if (s === null) return;
    const road = this.course.road;
    const terrain = this.course.terrain;
    const p = road.pointAt(s, createRoadPoint());
    const span = p.halfWidth + 3.2;
    const geo = new TorusGeometry(span, 2.1, 6, 12, Math.PI);
    const pos = geo.getAttribute('position');
    const rng = new Rng(77);
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) + rng.range(-0.4, 0.4),
        pos.getY(i) * 1.15 + rng.range(-0.3, 0.3),
        pos.getZ(i) * 1.4 + rng.range(-0.4, 0.4),
      );
    }
    geo.computeVertexNormals();
    const arch = new Mesh(
      geo.toNonIndexed(),
      new MeshLambertMaterial({ color: '#8c857b', flatShading: true }),
    );
    geo.dispose();
    arch.geometry.computeVertexNormals();
    arch.position.set(p.x, p.y - 0.6, p.z);
    // Torus lies in the XY plane: rotate so its span crosses the road.
    arch.rotation.y = Math.atan2(p.tx, p.tz);
    arch.castShadow = true;
    arch.receiveShadow = true;
    this.group.add(arch);
    for (const side of [-1, 1]) {
      const x = p.x + p.tz * side * span;
      const z = p.z - p.tx * side * span;
      const y = terrain.height(x, z);
      this.colliders.addCircle('rock', x, z, 2.3, y - 2, y + 12);
      // Rock pile at the base of each pillar.
      const base = new Mesh(new CylinderGeometry(2.2, 3, 3, 7), arch.material);
      base.position.set(x, y + 0.6, z);
      base.castShadow = true;
      this.group.add(base);
    }
  }

  dispose(): void {
    this.textures.forEach((t) => t.dispose());
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mat = mesh.material as MeshLambertMaterial;
        mat.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
