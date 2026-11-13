import { Color, Vector3 } from 'three';
import { config, type QualityPreset } from '../config';
import { surfaces } from '../data/surfaces';
import type { RunSession } from '../game/session';
import { ParticlePool } from './particles';
import { PostFx } from './postfx';
import { Skidmarks } from './skidmarks';
import { SpeedLines } from './speedLines';

const PARTICLE_COLORS: Record<string, Color> = {
  dust: new Color('#b89b78'),
  snow: new Color('#f4f8fb'),
  mud: new Color('#5b4330'),
  gravel: new Color('#9c958a'),
};
const tmp = new Vector3();
const fwd = new Vector3();

/** Owns every transient visual effect of a run and reacts to run events. */
export class Effects {
  readonly dust: ParticlePool;
  readonly sparks: ParticlePool;
  readonly skidmarks: Skidmarks | null;
  readonly speedLines: SpeedLines | null;
  readonly postfx: PostFx;
  private readonly offs: (() => void)[] = [];
  private emitAcc = 0;
  private slowmo = 0;

  constructor(
    private readonly session: RunSession,
    preset: QualityPreset,
  ) {
    const sprite = session.world.textures.particle;
    this.dust = new ParticlePool(preset.particles, sprite, false);
    this.sparks = new ParticlePool(Math.round(preset.particles * 0.35), sprite, true);
    session.world.scene.add(this.dust.points, this.sparks.points);
    this.skidmarks = config.features.skidmarks ? new Skidmarks() : null;
    if (this.skidmarks) session.world.scene.add(this.skidmarks.mesh);
    this.speedLines = config.features.speedLines ? new SpeedLines() : null;
    if (this.speedLines) {
      this.speedLines.attach(session.camera.camera);
      session.world.scene.add(session.camera.camera);
    }
    const layer = document.getElementById('fx') ?? document.body;
    this.postfx = new PostFx(layer);
    const ev = session.events;
    this.offs.push(
      ev.on('vehicle:landed', ({ impact, airTime }) =>
        this.burstAtWheels(8 + Math.min(30, impact * 3 + airTime * 6), 3 + impact * 0.4),
      ),
      ev.on('vehicle:crash', ({ impact }) => {
        this.sparkBurst(Math.min(40, 10 + impact * 2));
        this.postfx.doFlash('rgba(255,80,60,0.35)', 0.6);
      }),
      ev.on('vehicle:splash', () => this.splash()),
      ev.on('collectible:picked', ({ kind }) => this.pickup(kind === 'crystal')),
      ev.on('checkpoint:passed', () => this.postfx.doFlash('rgba(120,255,190,0.25)', 0.5)),
      ev.on('fx:flash', ({ color, strength }) => this.postfx.doFlash(color, strength)),
      ev.on('fx:slowmo', ({ duration }) => (this.slowmo = duration)),
    );
  }

  private burstAtWheels(count: number, speed: number): void {
    const car = this.session.vehicle.physics;
    for (const w of car.wheels) {
      if (!w.contact) continue;
      const c = PARTICLE_COLORS[surfaces[w.surface].particle] ?? PARTICLE_COLORS.dust;
      for (let i = 0; i < count / 4; i++) {
        const a = Math.random() * Math.PI * 2;
        this.dust.emit(
          w.contactPoint.x,
          w.contactPoint.y + 0.2,
          w.contactPoint.z,
          Math.cos(a) * speed,
          Math.random() * speed * 0.6,
          Math.sin(a) * speed,
          c.r,
          c.g,
          c.b,
          0.9 + Math.random() * 0.8,
          0.9 + Math.random() * 0.6,
          1.5,
          2.5,
        );
      }
    }
  }

  private sparkBurst(count: number): void {
    const p = this.session.vehicle.physics.position;
    const v = this.session.vehicle.physics.velocity;
    for (let i = 0; i < count; i++) {
      this.sparks.emit(
        p.x,
        p.y,
        p.z,
        v.x * 0.3 + (Math.random() - 0.5) * 12,
        Math.random() * 7,
        v.z * 0.3 + (Math.random() - 0.5) * 12,
        1,
        0.75,
        0.3,
        0.25,
        0.4 + Math.random() * 0.4,
        14,
        0,
      );
    }
  }

  private splash(): void {
    const p = this.session.vehicle.physics.position;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      this.dust.emit(
        p.x,
        p.y,
        p.z,
        Math.cos(a) * s,
        4 + Math.random() * 6,
        Math.sin(a) * s,
        0.85,
        0.93,
        1,
        0.8,
        1,
        12,
        1.5,
      );
    }
  }

  private pickup(crystal: boolean): void {
    const p = this.session.vehicle.physics.position;
    const n = crystal ? 26 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3;
      if (crystal)
        this.sparks.emit(
          p.x,
          p.y + 1,
          p.z,
          Math.cos(a) * s,
          Math.random() * 5,
          Math.sin(a) * s,
          0.5,
          0.9,
          1,
          0.35,
          0.7,
          3,
          0,
        );
      else
        this.sparks.emit(
          p.x,
          p.y + 1,
          p.z,
          Math.cos(a) * s,
          Math.random() * 4,
          Math.sin(a) * s,
          1,
          0.85,
          0.3,
          0.25,
          0.5,
          4,
          0,
        );
    }
  }

  /** Continuous effects from the wheels, at the fixed rate. */
  fixedUpdate(dt: number): void {
    const car = this.session.vehicle.physics;
    const speed = car.speed;
    this.emitAcc += dt;
    const emitNow = this.emitAcc > 1 / 40;
    if (emitNow) this.emitAcc = 0;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const surf = surfaces[w.surface];
      const marking =
        w.contact && w.skid > 0.35 && surf.particle !== 'none' && w.surface !== 'grass';
      this.skidmarks?.add(i, w.contactPoint, marking);
      if (!emitNow || !w.contact) continue;
      const kind = surf.particle;
      if (kind === 'none') continue;
      const c = PARTICLE_COLORS[kind];
      // Mostly when sliding; a light trail at speed. Rear wheels only for the speed trail.
      const intensity = w.skid * 1.1 + (w.front ? 0 : (Math.max(0, speed - 14) / 60) * 0.35);
      if (Math.random() > intensity) continue;
      fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
      tmp.copy(w.contactPoint);
      const back = Math.min(8, speed * 0.25);
      this.dust.emit(
        tmp.x,
        tmp.y + 0.15,
        tmp.z,
        -fwd.x * back + (Math.random() - 0.5) * 2,
        0.4 + Math.random() * 1.2 + (kind === 'snow' ? 0.8 : 0),
        -fwd.z * back + (Math.random() - 0.5) * 2,
        c.r,
        c.g,
        c.b,
        0.35 + Math.random() * 0.35 + w.skid * 0.35,
        0.6 + Math.random() * 0.6,
        kind === 'snow' ? 2 : 0.6,
        1.8,
      );
    }
    // Nitro exhaust.
    if (car.nitroActive && emitNow) {
      fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
      const L = car.def.chassis.length / 2;
      tmp.copy(car.position).addScaledVector(fwd, -L - 0.3);
      this.sparks.emit(
        tmp.x,
        tmp.y + 0.1,
        tmp.z,
        -fwd.x * 6 + car.velocity.x * 0.8,
        0.5,
        -fwd.z * 6 + car.velocity.z * 0.8,
        0.4,
        0.7,
        1,
        0.5,
        0.25,
        0,
        1,
      );
    }
  }

  update(dt: number, realDt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
    this.dust.setViewportScale(this.session.ctx.renderer.height);
    this.sparks.setViewportScale(this.session.ctx.renderer.height);
    const car = this.session.vehicle.physics;
    const speed = car.speed;
    const intensity = Math.max(0, (speed - 30) / 25) + (car.nitroActive ? 0.6 : 0);
    this.speedLines?.update(realDt, intensity, speed);
    this.slowmo = Math.max(0, this.slowmo - realDt);
    this.postfx.update(realDt, car.nitroActive, this.slowmo > 0);
  }

  clear(): void {
    this.dust.clear();
    this.sparks.clear();
    this.skidmarks?.clear();
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.dust.dispose();
    this.sparks.dispose();
    this.skidmarks?.dispose();
    this.speedLines?.dispose();
    this.postfx.dispose();
  }
}
