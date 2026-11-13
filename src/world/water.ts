import {
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import type { Course } from '../terrain/course';

/**
 * Lake plane and river ribbon. Gentle animated waves are added in the vertex shader through
 * onBeforeCompile (no CPU work per frame besides one uniform).
 */
export class Water {
  readonly group = new Group();
  private readonly uniforms = { uTime: { value: 0 } };
  private readonly material: MeshLambertMaterial;

  constructor(course: Course, tint: string) {
    this.group.name = 'water';
    const color = new Color('#3f8fb0').lerp(new Color(tint), 0.25);
    this.material = new MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      flatShading: true,
      emissive: color,
      emissiveIntensity: 0.12,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
         vec4 wp = modelMatrix * vec4(position, 1.0);
         transformed.y += sin(wp.x * 0.15 + uTime * 1.3) * 0.12 + cos(wp.z * 0.12 + uTime * 0.9) * 0.12;`,
        );
    };
    const m = course.mountain;
    const lake = new Mesh(
      new CircleGeometry(m.def.lakeRadius * 2.4, 48, 0, Math.PI * 2).rotateX(-Math.PI / 2),
      this.material,
    );
    lake.position.set(0, m.def.lakeLevel, m.lakeCenterZ);
    lake.receiveShadow = true;
    this.group.add(lake);

    if (m.river) {
      const r = m.river;
      void r;
      const pos: number[] = [];
      const idx: number[] = [];
      let row = 0;
      for (let z = 0; z <= m.riverEndZ; z += 6) {
        if (m.riverStrength(z) < 0.15) {
          if (row > 0) break;
          continue;
        }
        const x = m.riverX(z);
        const level = m.waterLevel(x, z);
        const w = m.river.width * 0.5 + 1.2;
        pos.push(x - w, level, z, x + w, level, z);
        if (row > 0) {
          const a = (row - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        row++;
      }
      if (row > 1) {
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const river = new Mesh(geo, this.material);
        river.receiveShadow = true;
        this.group.add(river);
      }
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
