import type { MeshBasicMaterial } from 'three';
import {
  BackSide,
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../math/rng';
import type { TimeOfDayDef, WeatherDef } from '../data/types';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float sunSize;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 col = h > 0.0 ? mix(horizonColor, topColor, pow(min(h * 1.6, 1.0), 0.7)) : mix(horizonColor, bottomColor, min(-h * 4.0, 1.0));
  float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  col += sunColor * (pow(d, 900.0 / sunSize) * 1.6 + pow(d, 12.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Gradient sky dome with sun disc, stars, low-poly clouds and a ring of distant mountains.
 * Follows the camera horizontally.
 */
export class Sky {
  readonly group = new Group();
  private readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly stars: Points;
  private readonly clouds: InstancedMesh;
  private readonly backdrop: Mesh;
  private readonly cloudData: {
    x: number;
    y: number;
    z: number;
    s: number;
    r: number;
    speed: number;
  }[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  readonly sunDirection = new Vector3();

  constructor(
    time: TimeOfDayDef,
    weather: WeatherDef,
    cloudCount: number,
    seed: number,
    center: Vector3,
  ) {
    this.group.name = 'sky';
    const sunDir = this.sunDirection.setFromSphericalCoords(
      1,
      Math.PI / 2 - time.sunElevation,
      time.sunAzimuth,
    );
    const grey = new Color('#9aa3ad');
    const mixGrey = (c: string): Color => new Color(c).lerp(grey, weather.overcast);
    this.dome = new Mesh(
      new SphereGeometry(5000, 32, 16),
      new ShaderMaterial({
        uniforms: {
          topColor: { value: mixGrey(time.skyTop) },
          horizonColor: { value: mixGrey(time.skyHorizon) },
          bottomColor: { value: mixGrey(time.skyBottom) },
          sunColor: { value: new Color(time.sunColor).multiplyScalar(1 - weather.overcast * 0.85) },
          sunDir: { value: sunDir.clone() },
          sunSize: { value: time.id === 'night' ? 0.5 : 1.5 },
        },
        vertexShader,
        fragmentShader,
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Stars.
    const rng = new Rng(seed);
    const starPos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const v = new Vector3(rng.range(-1, 1), rng.range(0.05, 1), rng.range(-1, 1))
        .normalize()
        .multiplyScalar(4800);
      starPos.push(v.x, v.y, v.z);
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new Float32BufferAttribute(starPos, 3));
    this.stars = new Points(
      starGeo,
      new PointsMaterial({
        color: '#ffffff',
        size: 2.2,
        sizeAttenuation: false,
        fog: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.stars.visible = time.stars && weather.overcast < 0.3;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Clouds: merged blobs, instanced.
    const blobs = [];
    for (let i = 0; i < 5; i++) {
      const b = new IcosahedronGeometry(1, 0);
      b.scale(1.3 - i * 0.1, 0.7, 1);
      b.translate((i - 2) * 1.1, Math.abs(i - 2) * -0.25, rng.range(-0.4, 0.4));
      blobs.push(b);
    }
    const cloudGeo = mergeGeometries(blobs.map((b) => (b.index ? b.toNonIndexed() : b)));
    blobs.forEach((b) => b.dispose());
    cloudGeo.computeVertexNormals();
    const cloudColor = new Color(
      time.id === 'night' ? '#4a5470' : time.id === 'sunset' ? '#ffd2c0' : '#ffffff',
    ).lerp(grey, weather.overcast * 0.7);
    const n = Math.round(cloudCount * (0.5 + weather.cloudCover));
    this.clouds = new InstancedMesh(
      cloudGeo,
      new MeshLambertMaterial({
        color: cloudColor,
        flatShading: true,
        emissive: cloudColor,
        emissiveIntensity: 0.35,
        fog: false,
      }),
      n,
    );
    for (let i = 0; i < n; i++) {
      this.cloudData.push({
        x: center.x + rng.range(-6000, 6000),
        y: rng.range(2300, 3100),
        z: center.z + rng.range(-6000, 6000),
        s: rng.range(90, 200),
        r: rng.range(0, Math.PI * 2),
        speed: rng.range(1.5, 4),
      });
    }
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
    this.updateClouds(0);

    // Distant mountain ring (no fog, pre-tinted towards the fog colour for depth).
    const ring: BufferGeometry[] = [];
    const peaks = 46;
    for (let i = 0; i < peaks; i++) {
      const a = (i / peaks) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(9000, 11000);
      const h = rng.range(1600, 3600);
      const cone = new ConeGeometry(rng.range(1300, 2300), h, 5 + (i % 3), 1);
      const pos = cone.getAttribute('position');
      for (let k = 0; k < pos.count; k++) {
        if (pos.getY(k) > h / 2 - 1) continue;
        pos.setX(k, pos.getX(k) * rng.range(0.8, 1.2));
        pos.setZ(k, pos.getZ(k) * rng.range(0.8, 1.2));
      }
      cone.translate(center.x + Math.cos(a) * r, h / 2 - 100, center.z + Math.sin(a) * r);
      ring.push(cone.toNonIndexed());
      cone.dispose();
    }
    const ringGeo = mergeGeometries(ring);
    ring.forEach((g) => g.dispose());
    ringGeo.computeVertexNormals();
    const far = new Color('#5f6e86')
      .lerp(new Color(time.fogColor), 0.55)
      .lerp(grey, weather.overcast * 0.5);
    if (time.id === 'night') far.multiplyScalar(0.5);
    this.backdrop = new Mesh(
      ringGeo,
      new MeshLambertMaterial({
        color: far,
        flatShading: true,
        fog: false,
        emissive: far,
        emissiveIntensity: 0.55,
      }),
    );
    this.backdrop.renderOrder = -5;
    this.group.add(this.backdrop);
  }

  private updateClouds(t: number): void {
    const s = new Vector3();
    const p = new Vector3();
    const up = new Vector3(0, 1, 0);
    this.cloudData.forEach((c, i) => {
      p.set(c.x + t * c.speed, c.y, c.z);
      this.q.setFromAxisAngle(up, c.r);
      s.set(c.s, c.s * 0.6, c.s * 0.8);
      this.m.compose(p, this.q, s);
      this.clouds.setMatrixAt(i, this.m);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  private time = 0;
  update(dt: number, camera: Vector3): void {
    this.time += dt;
    this.dome.position.copy(camera);
    this.stars.position.copy(camera);
    // Clouds drift slowly; update rarely.
    if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4))
      this.updateClouds(this.time);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
    this.clouds.dispose();
    this.group.removeFromParent();
  }
}
