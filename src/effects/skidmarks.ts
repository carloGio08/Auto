import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, type Vector3 } from 'three';

/** Ring buffer of tyre-mark quads laid on the ground. One draw call. */
export class Skidmarks {
  readonly mesh: Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private next = 0;
  private readonly last: ({ x: number; y: number; z: number } | null)[] = [null, null, null, null];

  constructor(max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 6 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.mesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        color: '#2a2018',
        transparent: true,
        opacity: 0.42,
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
  add(i: number, p: Vector3, active: boolean, width = 0.26): void {
    const prev = this.last[i];
    if (!active) {
      this.last[i] = null;
      return;
    }
    if (!prev) {
      this.last[i] = { x: p.x, y: p.y, z: p.z };
      return;
    }
    const dx = p.x - prev.x;
    const dz = p.z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.4) return;
    if (len > 4) {
      this.last[i] = { x: p.x, y: p.y, z: p.z };
      return;
    }
    const nx = (-dz / len) * width * 0.5;
    const nz = (dx / len) * width * 0.5;
    const y0 = prev.y + 0.04;
    const y1 = p.y + 0.04;
    const k = this.next * 18;
    const P = this.pos;
    // Two triangles.
    P.set([prev.x - nx, y0, prev.z - nz, p.x - nx, y1, p.z - nz, prev.x + nx, y0, prev.z + nz], k);
    P.set([prev.x + nx, y0, prev.z + nz, p.x - nx, y1, p.z - nz, p.x + nx, y1, p.z + nz], k + 9);
    this.next = (this.next + 1) % this.max;
    prev.x = p.x;
    prev.y = p.y;
    prev.z = p.z;
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.pos.fill(0);
    this.last.fill(null);
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
