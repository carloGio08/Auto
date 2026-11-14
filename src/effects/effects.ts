import { Color, Vector3 } from 'three';
import { config, type QualityPreset } from '../config';
import { surfaces } from '../data/surfaces';
import type { SurfaceDef } from '../data/types';
import type { RunSession } from '../game/session';
import { clamp } from '../math/util';
import { PostFx } from './postfx';
import { shardKinds as K } from './shardKinds';
import { ShardSystem, type ShardKind } from './shards';
import { TireTracks, TRACK_CAPACITY, type WheelTrackInput } from './tireTracks';
import { SpeedLines } from './speedLines';

type Particle = SurfaceDef['particle'];

const tmp = new Vector3();
const fwd = new Vector3();
const upV = new Vector3();

/**
 * Owns every transient visual effect of a run and reacts to run events. Everything is
 * geometry (instanced low-poly shards, rings, prisms, tyre strips) coloured from the world
 * palette: no sprites, no textures.
 */
export class Effects {
  readonly shards: ShardSystem;
  readonly tracks: TireTracks | null;
  private readonly trackIn: WheelTrackInput = {
    contact: false,
    x: 0,
    y: 0,
    z: 0,
    surface: 'trail',
    skid: 0,
    load: 1,
    spin: 0,
    inWater: false,
  };
  readonly speedLines: SpeedLines | null;
  readonly postfx: PostFx;
  private readonly offs: (() => void)[] = [];
  private emitAcc = 0;
  private steamAcc = 0;
  private readonly colors: Record<Exclude<Particle, 'none'>, [Color, Color]>;
  private readonly water: Color;
  private readonly wood: [Color, Color];
  private readonly leaves: [Color, Color, Color];
  private readonly steam = new Color('#f1f3f5');
  private readonly spark = new Color('#ffb347');
  private readonly nitro = new Color('#7fdcff');
  private readonly gold = new Color('#ffd34d');
  private readonly cyan = new Color('#7ff3ff');

  constructor(
    private readonly session: RunSession,
    preset: QualityPreset,
  ) {
    const world = session.world;
    const pal = world.palette;
    this.shards = new ShardSystem(world.scene, preset.particles);
    this.setQuality(preset);
    const light = (c: Color, k: number): Color => c.clone().lerp(new Color(1, 1, 1), k);
    this.colors = {
      dust: [light(pal.earth[4], 0.18), light(pal.earth[3], 0.3)],
      snow: [pal.snow[4], pal.snow[2]],
      gravel: [pal.scree[3], pal.rockDark[2]],
      mud: [pal.mud[2], pal.earth[1]],
    };
    this.water = pal.water[2];
    this.wood = [pal.wood[2], pal.wood[1]];
    this.leaves = [pal.foliage[2], pal.foliage[1], pal.grass[2]];
    const trackSetting = session.ctx.save.data.settings.tireTracks;
    this.tracks =
      config.features.tireTracks && trackSetting !== 'off'
        ? new TireTracks(session.course.terrain, pal, TRACK_CAPACITY[trackSetting])
        : null;
    if (this.tracks) world.scene.add(this.tracks.mesh);
    this.speedLines = config.features.speedLines ? new SpeedLines() : null;
    if (this.speedLines) {
      this.speedLines.attach(session.camera.camera);
      world.scene.add(session.camera.camera);
    }
    const layer = document.getElementById('fx') ?? document.body;
    this.postfx = new PostFx(layer);
    const ev = session.events;
    this.offs.push(
      ev.on('vehicle:landed', ({ impact, airTime }) => this.landing(impact, airTime)),
      ev.on('vehicle:crash', ({ impact }) => {
        this.sparkBurst(Math.min(36, 8 + impact * 2));
        this.postfx.doFlash('rgba(255,80,60,0.3)', 0.5);
      }),
      ev.on('vehicle:splash', ({ speed }) => this.splash(speed)),
      ev.on('collectible:picked', ({ kind }) => this.pickup(kind === 'crystal')),
      ev.on('fx:flash', ({ color, strength }) => this.postfx.doFlash(color, strength)),
    );
  }

  /** Scales emission with the quality preset (pools keep their capacity). */
  setQuality(preset: QualityPreset): void {
    this.shards.density = clamp(preset.particles / 1600, 0.35, 1);
  }

  private pick(pair: [Color, Color] | [Color, Color, Color]): Color {
    return pair[(Math.random() * pair.length) | 0];
  }

  private kindFor(p: Exclude<Particle, 'none'>): ShardKind {
    return p === 'snow' ? K.snow : p === 'gravel' ? K.gravel : p === 'mud' ? K.mud : K.dust;
  }

  /** Dust/snow burst at every touching wheel plus an octagonal shock ring for big landings. */
  private landing(impact: number, airTime: number): void {
    const car = this.session.vehicle.physics;
    const count = 3 + Math.min(10, impact * 0.8 + airTime * 3);
    let ringDone = false;
    for (const w of car.wheels) {
      if (!w.contact) continue;
      const pk = surfaces[w.surface].particle;
      if (pk === 'none') continue;
      const cp = w.contactPoint;
      const kind = this.kindFor(pk);
      const pair = this.colors[pk];
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * (2 + impact * 0.25);
        this.shards.one(
          kind,
          cp.x,
          cp.y + 0.15,
          cp.z,
          Math.cos(a) * sp,
          1 + Math.random() * (1.5 + impact * 0.2),
          Math.sin(a) * sp,
          this.pick(pair),
          1.2,
          cp.y,
        );
      }
      if (!ringDone && airTime > 0.35) {
        ringDone = true;
        this.shards.one(K.ring, car.position.x, cp.y + 0.12, car.position.z, 0, 0, 0, pair[0], 1.2);
      }
    }
  }

  private sparkBurst(count: number): void {
    const p = this.session.vehicle.physics.position;
    const v = this.session.vehicle.physics.velocity;
    this.shards.burst(K.spark, count, p.x, p.y, p.z, v.x * 0.3, 3, v.z * 0.3, 7, this.spark);
  }

  private splash(speed: number): void {
    const p = this.session.vehicle.physics.position;
    const lvl = this.session.course.terrain.waterLevel(p.x, p.z);
    const y = Math.min(p.y, lvl + 0.05);
    const n = 14 + Math.min(30, speed);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 4;
      this.shards.one(
        K.drop,
        p.x,
        y + 0.2,
        p.z,
        Math.cos(a) * s,
        3 + Math.random() * 6,
        Math.sin(a) * s,
        this.water,
      );
    }
    this.shards.one(K.ring, p.x, y + 0.03, p.z, 0, 0, 0, this.steam, 1);
    this.shards.one(K.ring, p.x, y + 0.03, p.z, 0, 0, 0, this.water, 0.6);
  }

  /** Splinters and leaves for a broken tree (called by the trees system). */
  treeBurst(x: number, y: number, z: number, vx: number, vz: number, big: boolean): void {
    const n = big ? 22 : 12;
    for (let i = 0; i < n; i++) {
      this.shards.one(
        K.wood,
        x + (Math.random() - 0.5) * 0.6,
        y + 0.4 + Math.random() * 1.2,
        z + (Math.random() - 0.5) * 0.6,
        vx * 0.35 + (Math.random() - 0.5) * 6,
        2 + Math.random() * 4,
        vz * 0.35 + (Math.random() - 0.5) * 6,
        this.pick(this.wood),
        1,
        y,
      );
    }
    for (let i = 0; i < n * 1.4; i++) {
      this.shards.one(
        K.leaf,
        x + (Math.random() - 0.5) * 3,
        y + 2 + Math.random() * (big ? 6 : 3),
        z + (Math.random() - 0.5) * 3,
        vx * 0.15 + (Math.random() - 0.5) * 3,
        Math.random() * 2,
        vz * 0.15 + (Math.random() - 0.5) * 3,
        this.pick(this.leaves),
      );
    }
  }

  private pickup(crystal: boolean): void {
    const p = this.session.vehicle.physics.position;
    if (crystal) this.shards.burst(K.crystal, 22, p.x, p.y + 1, p.z, 0, 2, 0, 3.5, this.cyan);
    else this.shards.burst(K.coin, 10, p.x, p.y + 1, p.z, 0, 2, 0, 3, this.gold);
  }

  /** Continuous effects from the wheels, at the fixed rate. */
  fixedUpdate(dt: number): void {
    const car = this.session.vehicle.physics;
    const speed = car.speed;
    this.emitAcc += dt;
    const emitNow = this.emitAcc > 1 / 60;
    if (emitNow) this.emitAcc = 0;
    fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
    const staticLoad = (car.mass * config.physics.gravity) / 4;
    const wheelWidth = this.session.vehicle.def.look.wheelWidth;
    {
      const l = Math.hypot(fwd.x, fwd.z) || 1;
      fwd.x /= l;
      fwd.z /= l;
    }
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const pk = surfaces[w.surface].particle;
      if (this.tracks) {
        const t = this.trackIn;
        t.contact = w.contact;
        t.x = w.contactPoint.x;
        t.y = w.contactPoint.y;
        t.z = w.contactPoint.z;
        t.surface = w.surface;
        t.skid = w.skid;
        t.load = w.load / staticLoad;
        const roll = Math.abs(w.spinRate) * car.def.wheelRadius;
        t.spin = w.driven ? clamp((roll - Math.abs(w.longSpeed)) / 6, 0, 1) : 0;
        t.inWater = this.session.course.terrain.waterLevel(t.x, t.z) > t.y - 0.05;
        const inp = this.session.input;
        this.tracks.step(dt, i, t, wheelWidth, fwd.x, fwd.z, inp.handbrake, inp.brake);
      }
      if (!emitNow || !w.contact || pk === 'none') continue;
      // Mostly when sliding; a light trail at speed from the rear wheels.
      const intensity = w.skid * 1.2 + (w.front ? 0 : (Math.max(0, speed - 10) / 50) * 0.5);
      if (Math.random() > intensity) continue;
      tmp.copy(w.contactPoint);
      const back = Math.min(7, speed * 0.22);
      this.shards.burst(
        this.kindFor(pk),
        (pk === 'gravel' ? 2 : 1) + (w.skid > 0.5 ? 1 : 0),
        tmp.x,
        tmp.y + 0.15,
        tmp.z,
        -fwd.x * back,
        0.8 + (pk === 'snow' ? 1 : 0) + w.skid,
        -fwd.z * back,
        1.2,
        this.pick(this.colors[pk]),
        0.9 + w.skid * 0.6,
        tmp.y,
      );
      // Water spray when wading.
      if (car.submerged > 0.05 && speed > 3)
        this.shards.one(K.drop, tmp.x, tmp.y + 0.3, tmp.z, -fwd.x * 2, 3, -fwd.z * 2, this.water);
    }
    // Nitro: glowing diamonds out of the exhaust.
    const L = car.def.chassis.length / 2;
    if (car.nitroActive && emitNow) {
      tmp.copy(car.position).addScaledVector(fwd, -L - 0.3);
      this.shards.burst(
        K.nitro,
        2,
        tmp.x,
        tmp.y,
        tmp.z,
        -fwd.x * 7 + car.velocity.x * 0.8,
        0.3,
        -fwd.z * 7 + car.velocity.z * 0.8,
        0.8,
        this.nitro,
      );
    }
    // Engine steam: cold air at altitude or a hot engine working hard at low speed.
    const cold = car.position.y > this.session.course.def.biomes.treeLine;
    const rate = (cold ? 4 : 0) + (car.engineLoad > 0.8 && speed < 4 ? 3 : 0);
    this.steamAcc += rate * dt;
    if (this.steamAcc >= 1) {
      this.steamAcc -= 1;
      upV.set(0, 1, 0).applyQuaternion(car.quaternion);
      tmp
        .copy(car.position)
        .addScaledVector(fwd, -L - 0.1)
        .addScaledVector(upV, -0.15);
      this.shards.one(
        K.steam,
        tmp.x,
        tmp.y,
        tmp.z,
        car.velocity.x * 0.6 - fwd.x,
        0.6,
        car.velocity.z * 0.6 - fwd.z,
        this.steam,
      );
    }
  }

  update(dt: number, realDt: number): void {
    this.shards.update(dt);
    const car = this.session.vehicle.physics;
    const speed = car.speed;
    const intensity = Math.max(0, (speed - 26) / 20) + (car.nitroActive ? 0.6 : 0);
    this.speedLines?.update(realDt, intensity, speed);
    this.postfx.update(realDt, car.nitroActive);
    this.tracks?.update(car.position.x, car.position.z);
  }

  clear(): void {
    this.shards.clear();
    this.tracks?.clear();
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.shards.dispose();
    this.tracks?.dispose();
    this.speedLines?.dispose();
    this.postfx.dispose();
  }
}
