import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  type Color,
  type Vector3,
} from 'three';

/** Ring buffer of low-poly tyre strips laid on the ground, tinted per surface. One draw call. */
export class Skidmarks {
  readonly mesh: Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private next = 0;
  private readonly lx = new Float32Array(4);
  private readonly ly = new Float32Array(4);
  private readonly lz = new Float32Array(4);
  private readonly has = new Uint8Array(4);

  constructor(max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.mesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Adds a mark for wheel `i` at a contact point; `active` false breaks the trail. */
  add(i: number, p: Vector3, active: boolean, color: Color, width = 0.3): void {
    if (!active) {
      this.has[i] = 0;
      return;
    }
    if (!this.has[i]) {
      this.setLast(i, p);
      return;
    }
    const px = this.lx[i];
    const py = this.ly[i];
    const pz = this.lz[i];
    const dx = p.x - px;
    const dz = p.z - pz;
    const len = Math.hypot(dx, dz);
    if (len < 0.4) return;
    if (len > 4) {
      this.setLast(i, p);
      return;
    }
    const nx = (-dz / len) * width * 0.5;
    const nz = (dx / len) * width * 0.5;
    const y0 = py + 0.04;
    const y1 = p.y + 0.04;
    const k = this.next * 18;
    // Two triangles.
    this.put(k, px - nx, y0, pz - nz);
    this.put(k + 3, p.x - nx, y1, p.z - nz);
    this.put(k + 6, px + nx, y0, pz + nz);
    this.put(k + 9, px + nx, y0, pz + nz);
    this.put(k + 12, p.x - nx, y1, p.z - nz);
    this.put(k + 15, p.x + nx, y1, p.z + nz);
    for (let v = 0; v < 6; v++) {
      this.col[k + v * 3] = color.r;
      this.col[k + v * 3 + 1] = color.g;
      this.col[k + v * 3 + 2] = color.b;
    }
    this.next = (this.next + 1) % this.max;
    this.setLast(i, p);
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  private put(o: number, x: number, y: number, z: number): void {
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
  }

  private setLast(i: number, p: Vector3): void {
    this.lx[i] = p.x;
    this.ly[i] = p.y;
    this.lz[i] = p.z;
    this.has[i] = 1;
  }

  clear(): void {
    this.pos.fill(0);
    this.has.fill(0);
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
