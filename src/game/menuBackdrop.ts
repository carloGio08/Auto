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
      weather: { ...weathers.clear, fogDensity: 0.85 },
      preset: ctx.renderer.preset,
      terrain: ctx.terrain,
    });
    // Park on a gentle spot below the summit with an open view: the ground ahead keeps
    // falling away (no rise blocking the view) for a few hundred metres. A few directions
    // around the way to the base are tried; the best drop wins.
    const d = mountain;
    const terrain = course.terrain;
    const toBase = Math.atan2(d.base.x - d.summit.x, d.base.z - d.summit.z);
    let best = -Infinity;
    let bestK = d.summit.plateauRadius;
    let bestA = toBase;
    for (let da = -0.7; da <= 0.71; da += 0.175) {
      const ang = toBase + da;
      const ux = Math.sin(ang);
      const uz = Math.cos(ang);
      const at = (k: number): number => terrain.height(d.summit.x + ux * k, d.summit.z + uz * k);
      for (let k = d.summit.plateauRadius * 0.6; k < 1400; k += 15) {
        const h = at(k);
        if (Math.abs(at(k + 5) - at(k - 5)) / 10 > 0.2) continue;
        let open = true;
        for (let a = 30; a <= 450 && open; a += 30) if (at(k + a) > h - a * 0.12) open = false;
        if (!open) continue;
        const score = h - at(k + 450) - k * 0.05;
        if (score > best) {
          best = score;
          bestK = k;
          bestA = ang;
        }
        break;
      }
    }
    this.downhill.set(Math.sin(bestA), 0, Math.cos(bestA));
    const dist = bestK;
    this.carPos.set(d.summit.x + this.downhill.x * dist, 0, d.summit.z + this.downhill.z * dist);
    this.carPos.y = terrain.groundHeight(
      this.carPos.x,
      this.carPos.z,
      terrain.height(this.carPos.x, this.carPos.z) + 5,
    );
    this.world.buildNow(this.carPos);
    // See the whole descent: the fog starts further away than during a run.
    this.world.setFogScale(1.6);
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
      this.carPos.y + 12 - this.parallaxY * 0.8,
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
      this.carPos.y - 230,
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
