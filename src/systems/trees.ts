import { Vector3 } from 'three';
import { treeBreaks, treeTiers } from '../data/trees';
import type { Collider } from '../world/colliders';
import { TreeDebris } from '../world/treeDebris';
import type { VehiclePhysics } from '../vehicle/physics';
import { BaseSystem } from './system';

const dir = new Vector3();

/**
 * Destructible trees. Hooks the collision world: young trees always snap, medium ones above an
 * energy threshold, old ones stay solid. A snapped tree leaves a stump, throws 1–3 tumbling
 * pieces plus splinters and leaves, shakes the camera, buzzes the phone and slows the jeep in
 * proportion to its robustness. Emits `treeBroken`.
 */
export class TreesSystem extends BaseSystem {
  readonly id = 'trees' as const;
  private debris!: TreeDebris;

  protected setup(): void {
    const s = this.session;
    const world = s.world;
    this.debris = new TreeDebris(world.scene, world.palette, world.preset.shadows);
    world.colliders.breakHandler = (c, speed, car) => this.onHit(c, speed, car);
    this.onEvent('run:start', () => this.debris.clear());
  }

  private onHit(c: Collider, impactSpeed: number, car: VehiclePhysics): boolean {
    const world = this.session.world;
    const t = world.props.treeOf(c);
    if (!t || !treeBreaks(t.tier, car.mass, impactSpeed)) return false;
    const def = treeTiers[t.tier];
    world.props.breakTree(t);
    // Robustness: the jeep loses a share of its speed.
    car.velocity.multiplyScalar(1 - def.speedLoss);
    const speed = car.speed;
    dir.copy(car.velocity).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const v = car.velocity;
    const base = t.y + 0.45 * t.scale;
    if (t.tier === 'young') {
      this.debris.spawn(
        0,
        t.x,
        base + 1.6 * t.scale,
        t.z,
        t.scale,
        v.x * 0.7,
        2,
        v.z * 0.7,
        dir.x,
        dir.z,
        1.5 + impactSpeed * 0.25,
      );
    } else {
      this.debris.spawn(
        1,
        t.x,
        base + 3.2 * t.scale,
        t.z,
        t.scale,
        v.x * 0.45,
        1,
        v.z * 0.45,
        dir.x,
        dir.z,
        0.8 + impactSpeed * 0.1,
      );
      const logs = def.pieces - 1 + (impactSpeed > 16 ? 1 : 0);
      for (let i = 0; i < logs; i++)
        this.debris.spawn(
          2,
          t.x + dir.x * 0.8,
          base + 1 + i * 0.9,
          t.z + dir.z * 0.8,
          t.scale * 0.8,
          v.x * 0.8 + (Math.random() - 0.5) * 3,
          3 + Math.random() * 2,
          v.z * 0.8 + (Math.random() - 0.5) * 3,
          dir.x,
          dir.z,
          4 + Math.random() * 4,
        );
    }
    const s = this.session;
    s.effects.treeBurst(t.x, base, t.z, v.x, v.z, t.tier !== 'young');
    s.events.emit('fx:shake', { amount: def.shake });
    s.events.emit('haptic', { pattern: t.tier === 'young' ? 18 : [30, 20, 40] });
    s.events.emit('treeBroken', { tier: t.tier, x: t.x, y: t.y, z: t.z, speed });
    return true;
  }

  fixedUpdate(dt: number): void {
    const ph = this.session.vehicle.physics;
    this.debris.step(dt, this.session.course.terrain, ph.position, ph.velocity);
  }

  update(): void {
    this.debris.sync();
  }

  protected override teardown(): void {
    this.session.world.colliders.breakHandler = null;
    this.debris.dispose();
  }
}
