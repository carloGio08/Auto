import type { Mesh } from 'three';
import { MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { CarModel } from '../vehicle/model';
import { BaseSystem } from './system';

const RATE = 20;
const STRIDE = 7;

/** Encodes a recording (Float32 frames) + header into a compact base64 string. */
export function encodeGhost(time: number, carId: string, frames: Float32Array): string {
  const bytes = new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return JSON.stringify({ v: 1, time, carId, rate: RATE, data: btoa(bin) });
}

export function decodeGhost(
  raw: string,
): { time: number; carId: string; frames: Float32Array } | null {
  try {
    const o = JSON.parse(raw) as { v: number; time: number; carId: string; data: string };
    if (o.v !== 1) return null;
    const bin = atob(o.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { time: o.time, carId: o.carId, frames: new Float32Array(bytes.buffer) };
  } catch {
    return null;
  }
}

const pa = new Vector3();
const pb = new Vector3();
const qa = new Quaternion();
const qb = new Quaternion();

/** Records the run and replays the best one as a translucent car. */
export class GhostSystem extends BaseSystem {
  readonly id = 'ghost' as const;
  private buffer = new Float32Array(RATE * 60 * STRIDE);
  private frames = 0;
  private acc = 0;
  private replay: { time: number; frames: Float32Array } | null = null;
  private ghost: CarModel | null = null;
  private dirty = false;

  protected setup(): void {
    const { ctx, cfg, world } = this.session;
    const raw = ctx.save.loadGhost(cfg.track.id);
    const data = raw ? decodeGhost(raw) : null;
    if (data && ctx.registries.cars.has(data.carId)) {
      this.replay = data;
      const car = ctx.registries.cars.get(data.carId);
      this.ghost = new CarModel(car, '#9fd8ff');
      const mat = new MeshBasicMaterial({
        color: '#bfe6ff',
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      this.ghost.root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.castShadow = false;
        }
      });
      this.ghost.setRestPose();
      this.ghost.root.visible = false;
      world.scene.add(this.ghost.root);
    }
    this.onEvent('run:finish', ({ time }) => this.store(time));
    this.onEvent('run:reset', ({ manual }) => {
      // A respawn invalidates the recording continuity but we keep recording from here.
      this.dirty = this.dirty || manual;
    });
  }

  private store(time: number): void {
    const { ctx, cfg } = this.session;
    if (!cfg.mode.recordsEnabled) return;
    if (this.replay && this.replay.time <= time) return;
    ctx.save.saveGhost(
      cfg.track.id,
      encodeGhost(time, this.session.vehicle.def.id, this.buffer.slice(0, this.frames * STRIDE)),
    );
  }

  fixedUpdate(dt: number): void {
    const s = this.session;
    if (s.phase !== 'running') return;
    this.acc += dt;
    const step = 1 / RATE;
    while (this.acc >= step) {
      this.acc -= step;
      if ((this.frames + 1) * STRIDE > this.buffer.length) {
        const bigger = new Float32Array(this.buffer.length * 2);
        bigger.set(this.buffer);
        this.buffer = bigger;
      }
      const p = s.vehicle.physics.position;
      const q = s.vehicle.physics.quaternion;
      this.buffer.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], this.frames * STRIDE);
      this.frames++;
    }
  }

  update(): void {
    if (!this.ghost || !this.replay) return;
    const s = this.session;
    const f = this.replay.frames;
    const count = f.length / STRIDE;
    const t = s.time * RATE;
    const i = Math.floor(t);
    if (s.phase === 'countdown' || i >= count - 1) {
      this.ghost.root.visible = s.phase === 'countdown' && count > 0;
      if (s.phase === 'countdown' && count > 0) {
        this.ghost.root.position.set(f[0], f[1], f[2]);
        this.ghost.root.quaternion.set(f[3], f[4], f[5], f[6]);
      }
      return;
    }
    const a = t - i;
    const k = i * STRIDE;
    pa.set(f[k], f[k + 1], f[k + 2]);
    pb.set(f[k + 7], f[k + 8], f[k + 9]);
    qa.set(f[k + 3], f[k + 4], f[k + 5], f[k + 6]);
    qb.set(f[k + 10], f[k + 11], f[k + 12], f[k + 13]);
    this.ghost.root.position.lerpVectors(pa, pb, a);
    this.ghost.root.quaternion.slerpQuaternions(qa, qb, a);
    // Hide when the player is right inside it.
    this.ghost.root.visible =
      this.ghost.root.position.distanceToSquared(s.vehicle.renderPosition) > 6;
  }

  protected override teardown(): void {
    this.ghost?.dispose();
  }
}
