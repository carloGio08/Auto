import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
} from 'three';
import type { CarDef } from '../data/types';
import { CarModel } from '../vehicle/model';

/** Studio scene with a turntable for the garage. Drag to rotate the car. */
export class GarageScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private car: CarModel | null = null;
  private angle = 0.6;
  private spin = 0.25;
  private dragging = false;
  private lastX = 0;
  private readonly platform: Mesh;
  private readonly ring: Mesh;

  constructor(
    aspect: number,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.scene.background = new Color('#1c2333');
    this.scene.fog = new Fog('#1c2333', 14, 40);
    this.camera = new PerspectiveCamera(42, aspect, 0.1, 100);
    const hemi = new HemisphereLight('#c8d8ff', '#3a3040', 1.2);
    const key = new DirectionalLight('#fff1dd', 2.4);
    key.position.set(5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const s = 5;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    const rim = new DirectionalLight('#7fb2ff', 1.4);
    rim.position.set(-6, 4, -7);
    this.platform = new Mesh(
      new CylinderGeometry(3.4, 3.6, 0.3, 40),
      new MeshStandardMaterial({ color: '#2c3446', roughness: 0.55, metalness: 0.3 }),
    );
    this.platform.position.y = -0.15;
    this.platform.receiveShadow = true;
    this.ring = new Mesh(
      new RingGeometry(3.45, 3.62, 48).rotateX(-Math.PI / 2),
      new MeshLambertMaterial({ color: '#ff7a3d', emissive: '#ff5a1d', emissiveIntensity: 0.8 }),
    );
    this.ring.position.y = 0.01;
    const floor = new Mesh(
      new CylinderGeometry(30, 30, 0.1, 40),
      new MeshLambertMaterial({ color: '#161b27' }),
    );
    floor.position.y = -0.35;
    floor.receiveShadow = true;
    this.scene.add(hemi, key, rim, this.platform, this.ring, floor);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.resize(aspect);
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.angle += (e.clientX - this.lastX) * 0.01;
    this.lastX = e.clientX;
    this.spin = 0;
  };
  private readonly onUp = (): void => {
    this.dragging = false;
    this.spin = 0.25;
  };

  setCar(def: CarDef, color: string): void {
    this.car?.dispose();
    this.car = new CarModel(def, color);
    this.car.setRestPose();
    const lift =
      -(def.physics.mountY - def.physics.suspension.restLength) + def.physics.wheelRadius - 0.1;
    this.car.root.position.set(0, lift, 0);
    this.car.shadow.visible = false;
    this.scene.add(this.car.root);
  }

  setColor(color: string): void {
    this.car?.setColor(color);
  }

  update(dt: number): void {
    this.angle += this.spin * dt;
    if (this.car) this.car.root.rotation.y = this.angle;
    this.platform.rotation.y = this.angle;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // Car on the left half on wide screens (UI panel on the right).
    const wide = aspect > 1.3;
    this.camera.position.set(wide ? 1.8 : 0, 2.6, 8.6);
    this.camera.lookAt(wide ? 1.9 : 0, 0.5, 0);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.car?.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as MeshLambertMaterial).dispose();
      }
    });
  }
}
