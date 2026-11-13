import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { config } from '../config';
import type { CollectiblePlacement } from '../terrain/course';
import { BaseSystem } from './system';

const m = new Matrix4();
const q = new Quaternion();
const s = new Vector3();
const p = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const zero = new Vector3(0, 0, 0);

/** Spinning coins and crystals placed along the course, picked up by driving through them. */
export class CollectiblesSystem extends BaseSystem {
  readonly id = 'collectibles' as const;
  private coins!: InstancedMesh;
  private crystals!: InstancedMesh;
  private coinItems: CollectiblePlacement[] = [];
  private crystalItems: CollectiblePlacement[] = [];
  private coinTaken: Uint8Array = new Uint8Array(0);
  private crystalTaken: Uint8Array = new Uint8Array(0);
  private time = 0;

  protected setup(): void {
    const items = this.session.course.collectibles;
    this.coinItems = items.filter((i) => i.kind === 'coin');
    this.crystalItems = items.filter((i) => i.kind === 'crystal');
    this.coinTaken = new Uint8Array(this.coinItems.length);
    this.crystalTaken = new Uint8Array(this.crystalItems.length);
    const coinGeo = new CylinderGeometry(0.55, 0.55, 0.12, 12).rotateX(Math.PI / 2);
    this.coins = new InstancedMesh(
      coinGeo,
      new MeshLambertMaterial({
        color: '#ffd23f',
        emissive: '#a86f00',
        emissiveIntensity: 0.6,
        flatShading: true,
      }),
      Math.max(1, this.coinItems.length),
    );
    const crystalGeo = new OctahedronGeometry(0.8, 0).scale(0.7, 1.3, 0.7);
    this.crystals = new InstancedMesh(
      crystalGeo,
      new MeshLambertMaterial({
        color: '#7fe7ff',
        emissive: '#1fa6d6',
        emissiveIntensity: 0.9,
        flatShading: true,
      }),
      Math.max(1, this.crystalItems.length),
    );
    this.coins.count = this.coinItems.length;
    this.crystals.count = this.crystalItems.length;
    this.coins.frustumCulled = false;
    this.crystals.frustumCulled = false;
    this.session.world.scene.add(this.coins, this.crystals);
    this.refresh(true);
  }

  private refresh(all: boolean): void {
    const cam = this.session.camera.camera.position;
    const spin = this.time * 3;
    this.coinItems.forEach((c, i) => {
      if (!all && Math.abs(c.x - cam.x) + Math.abs(c.z - cam.z) > 160) return;
      q.setFromAxisAngle(yAxis, spin + i);
      p.set(c.x, c.y + Math.sin(this.time * 2 + i) * 0.15, c.z);
      m.compose(p, q, this.coinTaken[i] ? zero : s.setScalar(1));
      this.coins.setMatrixAt(i, m);
    });
    this.crystalItems.forEach((c, i) => {
      if (!all && Math.abs(c.x - cam.x) + Math.abs(c.z - cam.z) > 220) return;
      q.setFromAxisAngle(yAxis, spin * 0.6 + i);
      p.set(c.x, c.y + Math.sin(this.time * 1.5 + i) * 0.3, c.z);
      m.compose(p, q, this.crystalTaken[i] ? zero : s.setScalar(1));
      this.crystals.setMatrixAt(i, m);
    });
    this.coins.instanceMatrix.needsUpdate = true;
    this.crystals.instanceMatrix.needsUpdate = true;
  }

  fixedUpdate(): void {
    const car = this.session.vehicle.physics.position;
    const ev = this.session.events;
    for (let i = 0; i < this.coinItems.length; i++) {
      if (this.coinTaken[i]) continue;
      const c = this.coinItems[i];
      const dx = c.x - car.x;
      const dy = c.y - car.y;
      const dz = c.z - car.z;
      if (dx * dx + dz * dz < 4.8 && Math.abs(dy) < 2.6) {
        this.coinTaken[i] = 1;
        ev.emit('collectible:picked', { kind: 'coin', value: config.gameplay.coinValue });
      }
    }
    for (let i = 0; i < this.crystalItems.length; i++) {
      if (this.crystalTaken[i]) continue;
      const c = this.crystalItems[i];
      const dx = c.x - car.x;
      const dy = c.y - car.y;
      const dz = c.z - car.z;
      if (dx * dx + dz * dz < 7 && Math.abs(dy) < 3) {
        this.crystalTaken[i] = 1;
        ev.emit('collectible:picked', { kind: 'crystal', value: 1 });
        ev.emit('haptic', { pattern: [20, 40, 20] });
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.refresh(false);
  }

  summary(): { label: string; value: string }[] {
    let crystals = 0;
    this.crystalTaken.forEach((t) => (crystals += t));
    return [{ label: 'results.crystals', value: `${crystals}/${this.crystalItems.length}` }];
  }

  protected override teardown(): void {
    for (const mesh of [this.coins, this.crystals]) {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
      mesh.dispose();
      mesh.removeFromParent();
    }
  }
}
