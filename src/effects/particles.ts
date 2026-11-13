import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Texture,
} from 'three';

const vertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, tex.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
  #include <fog_fragment>
}`;

/**
 * Fixed-size particle pool rendered as one Points draw call. Emitting reuses the oldest slot,
 * so there is never any allocation at runtime.
 */
export class ParticlePool {
  readonly points: Points;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly growth: Float32Array;
  private next = 0;
  private active = 0;
  private readonly material: ShaderMaterial;

  constructor(capacity: number, sprite: Texture, additive: boolean) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        { uMap: { value: null }, uScale: { value: 600 } },
      ]),
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog: true,
    });
    this.material.uniforms.uMap.value = sprite;
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  setViewportScale(heightPx: number): void {
    this.material.uniforms.uScale.value = heightPx * 0.9;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    size: number,
    life: number,
    gravity = 0,
    growth = 1,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col[k] = r;
    this.col[k + 1] = g;
    this.col[k + 2] = b;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.growth[i] = growth;
    this.alpha[i] = 1;
    this.active = Math.min(this.capacity, this.active + 1);
  }

  update(dt: number): void {
    if (this.active === 0) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const t = this.life[i] / this.maxLife[i];
      this.vel[k + 1] -= this.gravity[i] * dt;
      const drag = 1 - dt * 1.2;
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.alpha[i] = Math.min(1, t * 2.2) * 0.9;
      this.size[i] = this.baseSize[i] * (1 + (1 - t) * this.growth[i]);
    }
    this.active = alive;
    const geo = this.points.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.active = 0;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
