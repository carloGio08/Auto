import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { createRoadPoint } from '../terrain/road';
import { BaseSystem } from './system';

/**
 * Checkpoint gates: flag poles on both sides of the road. Passing one (by progress along the
 * road, so shortcuts count) adds time in timed modes and moves the respawn point.
 */
export class CheckpointsSystem extends BaseSystem {
  readonly id = 'checkpoints' as const;
  private next = 0;
  private readonly group = new Group();
  private readonly flags: Mesh[][] = [];
  private readonly pending = new MeshLambertMaterial({ color: '#ff8a1f', side: DoubleSide });
  private readonly done = new MeshLambertMaterial({ color: '#2fd47a', side: DoubleSide });
  private readonly poleMat = new MeshLambertMaterial({ color: '#e9ecef' });
  private readonly poleGeo = new CylinderGeometry(0.08, 0.1, 4.5, 6).translate(0, 2.25, 0);
  private readonly flagGeo: BufferGeometry;
  private time = 0;

  constructor() {
    super();
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 4.4, 0, 0, 3.4, 0, 1.4, 3.9, 0], 3));
    g.computeVertexNormals();
    this.flagGeo = g;
  }

  protected setup(): void {
    const { course, world } = this.session;
    const p = createRoadPoint();
    course.checkpoints.forEach((s) => {
      course.road.pointAt(s, p);
      const flags: Mesh[] = [];
      for (const side of [-1, 1]) {
        const off = side * (p.halfWidth + 0.8);
        const x = p.x + p.tz * off;
        const z = p.z - p.tx * off;
        const y = course.terrain.groundHeight(x, z, p.y + 2);
        const pole = new Mesh(this.poleGeo, this.poleMat);
        pole.position.set(x, y - 0.1, z);
        pole.castShadow = true;
        const flag = new Mesh(this.flagGeo, this.pending);
        flag.rotation.y = Math.atan2(-p.tx, -p.tz) + Math.PI / 2;
        pole.add(flag);
        flags.push(flag);
        this.group.add(pole);
      }
      this.flags.push(flags);
    });
    world.scene.add(this.group);
  }

  fixedUpdate(): void {
    const s = this.session;
    if (s.phase !== 'running') return;
    const cps = s.course.checkpoints;
    while (this.next < cps.length && s.progressS >= cps[this.next]) {
      const index = this.next++;
      const bonus = s.cfg.mode.timed ? s.cfg.track.checkpointBonus : 0;
      s.timeLeft += bonus;
      s.respawnS = cps[index];
      this.flags[index].forEach((f) => (f.material = this.done));
      s.events.emit('checkpoint:passed', { index, total: cps.length, bonus, split: s.time });
      s.events.emit('haptic', { pattern: 30 });
    }
  }

  update(dt: number): void {
    this.time += dt;
    // Flags flutter.
    for (const pair of this.flags)
      for (const f of pair) f.scale.z = 1 + Math.sin(this.time * 9 + f.id) * 0.25;
  }

  protected override teardown(): void {
    this.group.removeFromParent();
    this.poleGeo.dispose();
    this.flagGeo.dispose();
    this.pending.dispose();
    this.done.dispose();
    this.poleMat.dispose();
  }
}
