import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { config } from '../config';
import type { ResolvedPalette } from '../data/palette';
import { ROAD_BRIDGE, ROAD_FORD } from '../terrain/road';
import type { Terrain } from '../terrain/terrain';

/** Rut profile across: lateral offsets from the rut centre (m) and alpha, outside → in. */
const PROFILE = [
  [-0.34, 0],
  [-0.22, 0.95],
  [-0.08, 0.7],
  [0.08, 0.7],
  [0.22, 0.95],
  [0.34, 0],
] as const;
const ROW = PROFILE.length;
/** Vertices per rut segment (two rows) and indices (5 quads). */
const SEG_V = ROW * 2;
const SEG_I = (ROW - 1) * 6;

/**
 * Crisp baked wheel ruts near the camera: two ribbons per trail lying exactly on the
 * terrain's rut depressions (±`rutOffset` m from the spline centre, see Terrain.microRelief),
 * with dark walls, a slightly lighter floor and soft outer edges. The vertex colours of the
 * terrain carry the same ruts at every distance; these ribbons only sharpen them where a
 * vertex spacing of ~1 m could not. Rebuilt in place (no allocations) when the camera has
 * moved `rebuildStep` m.
 */
export class RutDecals {
  readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly capacity: number;
  private cx = Infinity;
  private cz = Infinity;
  private readonly wall = new Color();
  private readonly floor = new Color();

  constructor(
    private readonly terrain: Terrain,
    palette: ResolvedPalette,
    capacity = 1600,
  ) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * SEG_V * 3);
    this.col = new Float32Array(capacity * SEG_V * 4);
    const idx = new Uint32Array(capacity * SEG_I);
    for (let s = 0; s < capacity; s++) {
      const b = s * SEG_V;
      for (let k = 0; k < ROW - 1; k++) {
        const o = s * SEG_I + k * 6;
        const a0 = b + k;
        const a1 = b + k + 1;
        const b0 = b + ROW + k;
        const b1 = b + ROW + k + 1;
        idx.set([a0, b0, a1, a1, b0, b1], o);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 4).setUsage(DynamicDrawUsage));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.wall.copy(palette.earth[0]).multiplyScalar(0.72);
    this.floor.copy(palette.earth[1]).multiplyScalar(0.82);
    this.mesh = new Mesh(
      geo,
      new MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.mesh.name = 'ruts';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  update(camX: number, camZ: number): void {
    const step = config.world.ruts.rebuildStep;
    if (Math.abs(camX - this.cx) < step && Math.abs(camZ - this.cz) < step) return;
    this.cx = camX;
    this.cz = camZ;
    this.rebuild(camX, camZ);
  }

  /** Forces a rebuild at the next update (e.g. after a teleport). */
  invalidate(): void {
    this.cx = this.cz = Infinity;
  }

  private rebuild(camX: number, camZ: number): void {
    const road = this.terrain.road;
    const { radius, offset } = config.world.ruts;
    const r2 = radius * radius;
    let n = 0;
    for (const tr of road.trails) {
      for (let i = 0; i < tr.count - 1 && n < this.capacity - 1; i++) {
        const g = tr.start + i;
        const dx = road.x[g] - camX;
        const dz = road.z[g] - camZ;
        if (dx * dx + dz * dz > r2) continue;
        if ((road.flags[g] | road.flags[g + 1]) & (ROAD_BRIDGE | ROAD_FORD)) continue;
        if (this.terrain.trailSnow(road.x[g], road.z[g], road.y[g])) continue;
        for (let side = -1; side <= 1; side += 2) {
          if (n >= this.capacity) break;
          this.segment(n++, g, side * offset);
        }
      }
    }
    this.mesh.geometry.setDrawRange(0, n * SEG_I);
    const geo = this.mesh.geometry;
    (geo.attributes.position as BufferAttribute).needsUpdate = true;
    (geo.attributes.color as BufferAttribute).needsUpdate = true;
  }

  /** Writes one rut segment between road samples g and g + 1 at lateral offset `lat`. */
  private segment(n: number, g: number, lat: number): void {
    const road = this.terrain.road;
    const t = this.terrain;
    const lift = config.world.ruts.lift;
    for (let r = 0; r < 2; r++) {
      const k = g + r;
      // Lateral axis of the spline (same convention as Road.query's signed lateral).
      const nx = road.tz[k];
      const nz = -road.tx[k];
      for (let p = 0; p < ROW; p++) {
        const l = lat + PROFILE[p][0];
        const x = road.x[k] + nx * l;
        const z = road.z[k] + nz * l;
        const v = n * SEG_V + r * ROW + p;
        this.pos[v * 3] = x;
        this.pos[v * 3 + 1] = t.height(x, z) + lift;
        this.pos[v * 3 + 2] = z;
        const c = p === 1 || p === ROW - 2 || p === 0 || p === ROW - 1 ? this.wall : this.floor;
        this.col[v * 4] = c.r;
        this.col[v * 4 + 1] = c.g;
        this.col[v * 4 + 2] = c.b;
        this.col[v * 4 + 3] = PROFILE[p][1] * config.world.ruts.opacity;
      }
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
