import { PerspectiveCamera, Vector3 } from 'three';
import type { GameContext } from '../core/context';
import { timesOfDay, weathers } from '../data/environment';
import { damp } from '../math/util';
import { Course } from '../terrain/course';
import { createRoadPoint } from '../terrain/road';
import { CarModel } from '../vehicle/model';
import { World } from '../world/world';

/**
 * Live 3D background for the menus: the selected car parked at the summit of the first
 * track at sunset, a slow cinematic camera pan and gentle parallax from mouse/gyroscope.
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
    const course = new Course(mountain);
    this.world = new World({
      course,
      time: timesOfDay.sunset,
      weather: { ...weathers.clear, fogDensity: 1.15 },
      preset: ctx.renderer.preset,
    });
    this.world.buildNow();
    // Park the car on the outside of the first bend, facing down the mountain.
    const p = course.road.pointAt(course.startS + 14, createRoadPoint());
    const side = -1;
    const off = side * (p.halfWidth - 1.5);
    this.carPos.set(p.x + p.tz * off, 0, p.z - p.tx * off);
    this.carPos.y = course.terrain.groundHeight(this.carPos.x, this.carPos.z, p.y + 2);
    this.downhill.set(p.tx, 0, p.tz);
    this.car = this.makeCar();
    this.camera = new PerspectiveCamera(55, ctx.renderer.width / ctx.renderer.height, 0.3, 13000);
    this.world.update(0, this.carPos, this.carPos, 50);
    window.addEventListener('pointermove', this.onPointer);
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  private makeCar(): CarModel {
    const save = this.ctx.save.data;
    const def = this.ctx.registries.cars.get(save.selectedCar);
    const car = new CarModel(def, save.carColors[def.id] ?? def.look.colors[0]);
    car.setRestPose();
    const ph = def.physics;
    const compression = (ph.mass * 15) / 4 / ph.suspension.stiffness;
    const bodyLift = ph.wheelRadius - (ph.mountY - ph.suspension.restLength + compression) - 0.02;
    car.root.position.set(this.carPos.x, this.carPos.y + bodyLift, this.carPos.z);
    car.root.rotation.y = Math.atan2(this.downhill.x, this.downhill.z) + 0.5;
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
    // Slow pendulum pan behind the car, looking down the valley (+Z), car in the right third.
    const a = Math.sin(this.time * 0.07) * 0.35 + this.parallaxX * 0.1;
    const dirX = Math.sin(a);
    const dirZ = Math.cos(a);
    const r = 11 + Math.sin(this.time * 0.05) * 1.5;
    const cam = this.camera;
    const leftX = dirZ;
    const leftZ = -dirX;
    const side = 2.2 * Math.min(1.6, cam.aspect / 1.4);
    cam.position.set(
      this.carPos.x - dirX * r - leftX * side,
      this.carPos.y + 4.6 - this.parallaxY * 0.8,
      this.carPos.z - dirZ * r - leftZ * side,
    );
    const gy = this.world.course.terrain.groundHeight(
      cam.position.x,
      cam.position.z,
      cam.position.y + 3,
    );
    cam.position.y = Math.max(cam.position.y, gy + 1.5);
    this.lookTarget.set(
      this.carPos.x + dirX * 30 + leftX * side * 3.2,
      this.carPos.y - 6,
      this.carPos.z + dirZ * 30 + leftZ * side * 3.2,
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
