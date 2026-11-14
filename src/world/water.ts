import { applyAtmosphere } from './atmosphere';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  RingGeometry,
} from 'three';
import type { ResolvedPalette } from '../data/palette';
import type { Course } from '../terrain/course';

/**
 * Lake and river ribbons in the palette's water colour. Gentle animated waves come from the
 * vertex shader (onBeforeCompile), so there is no CPU work per frame besides one uniform.
 */
export class Water {
  readonly group = new Group();
  private readonly uniforms = { uTime: { value: 0 } };
  private readonly material: MeshLambertMaterial;

  constructor(course: Course, palette: ResolvedPalette) {
    this.group.name = 'water';
    const color = palette.water[2];
    this.material = new MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      flatShading: true,
      emissive: palette.water[1],
      emissiveIntensity: 0.25,
    });
    this.material.onBeforeCompile = (shader) => {
      applyAtmosphere(shader);
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
         vec4 wp = modelMatrix * vec4(position, 1.0);
         transformed.y += sin(wp.x * 0.11 + uTime * 1.1) * 0.15 + cos(wp.z * 0.09 + uTime * 0.8) * 0.15;`,
        );
    };
    const lake = course.def.lake;
    const geo = new RingGeometry(0, lake.radius * 1.25, 40, 10).rotateX(-Math.PI / 2);
    geo.scale(1, 1, 1 / 1.15);
    const lakeMesh = new Mesh(geo, this.material);
    lakeMesh.position.set(lake.x, lake.level, lake.z);
    lakeMesh.receiveShadow = true;
    this.group.add(lakeMesh);

    const m = course.mountain;
    for (const river of m.rivers) {
      const pos: number[] = [];
      const idx: number[] = [];
      const n = river.x.length;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        let tx = river.x[b] - river.x[a];
        let tz = river.z[b] - river.z[a];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const w = river.width * 0.5 + 1;
        const level = m.waterLevel(river.x[i], river.z[i]);
        pos.push(
          river.x[i] + tz * w,
          level,
          river.z[i] - tx * w,
          river.x[i] - tz * w,
          level,
          river.z[i] + tx * w,
        );
        if (i > 0) {
          const k = (i - 1) * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new Mesh(g, this.material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
  }

  dispose(): void {
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
    this.material.dispose();
    this.group.removeFromParent();
  }
}
