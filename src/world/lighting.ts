import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  type Scene,
  type Vector3,
} from 'three';
import { config } from '../config';
import type { TimeOfDayDef, WeatherDef } from '../data/types';

/** Sun (shadow-casting, follows the focus point) + hemisphere ambient. */
export class Lighting {
  readonly sun: DirectionalLight;
  readonly ambient: HemisphereLight;
  private readonly target = new Object3D();
  private readonly offset: Vector3;

  constructor(
    scene: Scene,
    time: TimeOfDayDef,
    weather: WeatherDef,
    sunDirection: Vector3,
    shadowMapSize: number,
    shadows: boolean,
  ) {
    const dim = 1 - weather.overcast * 0.45;
    this.sun = new DirectionalLight(new Color(time.sunColor), time.sunIntensity * dim);
    this.offset = sunDirection.clone().multiplyScalar(160);
    // A sun below 12° makes very long, noisy shadows: clamp the shadow direction a bit.
    if (this.offset.y < 40) this.offset.y = 40;
    this.sun.target = this.target;
    const s = config.graphics.shadowExtent;
    const cam = this.sun.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 10;
    cam.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.setShadows(shadows, shadowMapSize);
    this.ambient = new HemisphereLight(
      new Color(time.ambientSky),
      new Color(time.ambientGround),
      time.ambientIntensity * (1 + weather.overcast * 0.25),
    );
    scene.add(this.sun, this.target, this.ambient);
  }

  setShadows(enabled: boolean, mapSize: number): void {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Keeps the shadow frustum centred on the focus point (snapped to texels to avoid shimmer). */
  follow(focus: Vector3): void {
    const texel = (config.graphics.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.offset.x, focus.y + this.offset.y, fz + this.offset.z);
    this.target.updateMatrixWorld();
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.ambient.dispose();
    this.sun.removeFromParent();
    this.ambient.removeFromParent();
    this.target.removeFromParent();
  }
}
