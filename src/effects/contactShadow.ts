import {
  DataTexture,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Vector3,
  type Scene,
} from 'three';
import type { Terrain } from '../terrain/terrain';

const SIZE = 64;

/** Radial falloff, squashed to the jeep's footprint by the plane's size. */
function blobTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j++)
    for (let i = 0; i < SIZE; i++) {
      const u = ((i + 0.5) / SIZE) * 2 - 1;
      const v = ((j + 0.5) / SIZE) * 2 - 1;
      const r = Math.min(1, Math.hypot(u, v));
      // Dense core, soft edge.
      const a = Math.pow(1 - r * r, 1.6);
      const k = (j * SIZE + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 0;
      data[k + 3] = Math.round(a * 255);
    }
  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const n = new Vector3();
const fwd = new Vector3();
const side = new Vector3();
const m = new Matrix4();
const q = new Quaternion();

/**
 * Soft dark blob under the jeep, lying on the ground (terrain normal, jeep heading) and fading
 * as the jeep leaves the ground: anchors it visually even where the shadow map is coarse.
 */
export class ContactShadow {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor(
    scene: Scene,
    private readonly terrain: Terrain,
    width = 2.9,
    length = 5.0,
    private readonly strength = 0.55,
  ) {
    const geo = new PlaneGeometry(width, length);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        color: 0x000000,
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        fog: false,
      }),
    );
    this.mesh.name = 'contactShadow';
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** @param pos jeep position, @param rot jeep orientation. */
  update(pos: Vector3, rot: Quaternion): void {
    const h = this.terrain.height(pos.x, pos.z);
    const air = pos.y - h - 0.9;
    const k = Math.max(0, 1 - Math.max(0, air) / 3.5);
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.material.opacity = this.strength * k;
    this.terrain.normal(pos.x, pos.z, n);
    fwd.set(0, 0, 1).applyQuaternion(rot);
    fwd.addScaledVector(n, -fwd.dot(n));
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    side.crossVectors(n, fwd);
    m.makeBasis(side, n, fwd);
    q.setFromRotationMatrix(m);
    m.compose(fwd.set(pos.x, h + 0.04, pos.z), q, side.set(1, 1, 1));
    this.mesh.matrix.copy(m);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
