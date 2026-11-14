import { PerspectiveCamera, Vector3 } from 'three';
import type { GameContext } from '../core/context';
import { timesOfDay, weathers } from '../data/environment';
import { damp } from '../math/util';
import { Course } from '../terrain/course';
import { CarModel } from '../vehicle/model';
import { World } from '../world/world';
import { configuredJeep } from './progression';

/**
 * Live 3D background for the menus: the selected jeep parked at the edge of the summit
 * plateau, looking out over the whole descent at sunset, with a slow cinematic camera pan and
 * gentle parallax from mouse/gyroscope.
 */
export class MenuBackdrop {
  readonly world: World;
  readonly camera: PerspectiveCamera;
  private car: CarModel;
  private readonly carPos = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly downhill = new Vector3();
  private time = 0;
  private parallaxX = 0;
  private parallaxY = 0;
  private targetPX = 0;
  private targetPY = 0;
  private readonly onPointer = (e: PointerEvent): void => {
    this.targetPX = (e.clientX / window.innerWidth) * 2 - 1;
    this.targetPY = (e.clientY / window.innerHeight) * 2 - 1;
  };
  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    this.targetPX = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 30));
    this.targetPY = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30));
  };

  constructor(private readonly ctx: GameContext) {
    const mountain = ctx.registries.mountains.all()[0];
    const course = new Course(mountain, ctx.terrain.getSync(mountain));
    this.world = new World({
      course,
      time: timesOfDay.sunset,
      weather: { ...weathers.clear, fogDensity: 1.15 },
      preset: ctx.renderer.preset,
      terrain: ctx.terrain,
    });
    this.world.buildNow();
    // Park at the plateau edge facing the base, where the ground starts to fall away.
    const d = mountain;
    this.downhill.set(d.base.x - d.summit.x, 0, d.base.z - d.summit.z).normalize();
    const top = course.terrain.height(d.summit.x, d.summit.z);
    let dist = d.summit.plateauRadius * 0.5;
    while (dist < d.summit.plateauRadius * 5) {
      const x = d.summit.x + this.downhill.x * (dist + 60);
      const z = d.summit.z + this.downhill.z * (dist + 60);
      if (course.terrain.height(x, z) < top - 30) break;
      dist += 5;
    }
    this.carPos.set(d.summit.x + this.downhill.x * dist, 0, d.summit.z + this.downhill.z * dist);
    this.carPos.y = course.terrain.groundHeight(this.carPos.x, this.carPos.z, top + 5);
    this.car = this.makeCar();
    this.camera = new PerspectiveCamera(55, ctx.renderer.width / ctx.renderer.height, 0.3, 13000);
    this.world.update(0, this.carPos, this.carPos, 50);
    window.addEventListener('pointermove', this.onPointer);
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  private makeCar(): CarModel {
    const save = this.ctx.save.data;
    const def = configuredJeep(save, this.ctx.registries.cars.get(save.selectedCar));
    const car = new CarModel(def, save.carColors[def.id] ?? def.look.colors[0]);
    car.setRestPose();
    const ph = def.physics;
    const compression = (ph.mass * 15) / 4 / ph.suspension.stiffness;
    const bodyLift = ph.wheelRadius - (ph.mountY - ph.suspension.restLength + compression) - 0.02;
    car.root.position.set(this.carPos.x, this.carPos.y + bodyLift, this.carPos.z);
    car.root.rotation.y = Math.atan2(this.downhill.x, this.downhill.z) + 0.35;
    car.enableHeadlights(true);
    car.shadow.position.set(this.carPos.x, this.carPos.y + 0.06, this.carPos.z);
    car.shadow.rotation.y = car.root.rotation.y;
    this.world.scene.add(car.root, car.shadow);
    return car;
  }

  /** Rebuilds the parked car (after changing car or colour in the garage). */
  refreshCar(): void {
    this.car.dispose();
    this.car = this.makeCar();
  }

  get view(): { scene: World['scene']; camera: PerspectiveCamera } {
    return { scene: this.world.scene, camera: this.camera };
  }

  update(dt: number): void {
    this.time += dt;
    this.parallaxX += (this.targetPX - this.parallaxX) * damp(2, dt);
    this.parallaxY += (this.targetPY - this.parallaxY) * damp(2, dt);
    // Slow pendulum pan behind the jeep, looking down the valley, jeep in the right third.
    const base = Math.atan2(this.downhill.x, this.downhill.z);
    const a = base + Math.sin(this.time * 0.07) * 0.35 + this.parallaxX * 0.1;
    const dirX = Math.sin(a);
    const dirZ = Math.cos(a);
    const r = 12 + Math.sin(this.time * 0.05) * 1.5;
    const cam = this.camera;
    const leftX = dirZ;
    const leftZ = -dirX;
    const side = 2.2 * Math.min(1.6, cam.aspect / 1.4);
    cam.position.set(
      this.carPos.x - dirX * r - leftX * side,
      this.carPos.y + 6.5 - this.parallaxY * 0.8,
      this.carPos.z - dirZ * r - leftZ * side,
    );
    const gy = this.world.course.terrain.groundHeight(
      cam.position.x,
      cam.position.z,
      cam.position.y + 3,
    );
    cam.position.y = Math.max(cam.position.y, gy + 1.5);
    this.lookTarget.set(
      this.carPos.x + dirX * 420 + leftX * side * 36,
      this.carPos.y - 120,
      this.carPos.z + dirZ * 420 + leftZ * side * 36,
    );
    cam.lookAt(this.lookTarget);
    this.world.update(dt, cam.position, this.carPos, 3);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.car.dispose();
    this.world.dispose();
  }
}
