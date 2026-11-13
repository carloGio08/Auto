import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SpotLight,
  type BufferGeometry,
  type Material,
} from 'three';
import type { CarDef } from '../data/types';

type Profile = [number, number][];

interface BodySpec {
  /** Lower body side profile (z forward, y up), relative to body base. */
  lower: Profile;
  /** Glass cabin profile. */
  cabin: Profile | null;
  bodyWidth: number;
  cabinWidth: number;
  roofThickness: number;
}

/** Side profiles per body style, in metres (length ≈ chassis length). */
function bodySpec(car: CarDef): BodySpec {
  const L = car.physics.chassis.length / 2;
  const w = car.physics.trackWidth + 0.05;
  switch (car.look.body) {
    case 'coupe':
      return {
        lower: [
          [-L, 0.12],
          [-L - 0.05, 0.42],
          [-L + 0.25, 0.62],
          [L * 0.1, 0.66],
          [L - 0.35, 0.56],
          [L + 0.05, 0.4],
          [L, 0.12],
        ],
        cabin: [
          [-L + 0.45, 0.62],
          [-L + 1.05, 0.98],
          [0.2, 1.0],
          [L * 0.45, 0.64],
        ],
        bodyWidth: w,
        cabinWidth: w * 0.78,
        roofThickness: 0.05,
      };
    case 'buggy':
      return {
        lower: [
          [-L, 0.2],
          [-L, 0.55],
          [-L + 0.6, 0.6],
          [L - 0.9, 0.55],
          [L - 0.2, 0.42],
          [L + 0.1, 0.3],
          [L - 0.1, 0.18],
        ],
        cabin: null,
        bodyWidth: w * 0.82,
        cabinWidth: 0,
        roofThickness: 0,
      };
    case 'truck':
      return {
        lower: [
          [-L, 0.15],
          [-L, 0.85],
          [L - 0.2, 0.85],
          [L + 0.08, 0.72],
          [L + 0.08, 0.3],
          [L - 0.1, 0.15],
        ],
        cabin: [
          [-0.25, 0.85],
          [-0.15, 1.6],
          [L * 0.45, 1.6],
          [L * 0.75, 0.85],
        ],
        bodyWidth: w,
        cabinWidth: w * 0.92,
        roofThickness: 0.07,
      };
    case 'rally':
    default:
      return {
        lower: [
          [-L, 0.14],
          [-L - 0.04, 0.6],
          [-L + 0.15, 0.72],
          [L * 0.25, 0.74],
          [L - 0.25, 0.66],
          [L + 0.05, 0.46],
          [L, 0.14],
        ],
        cabin: [
          [-L + 0.15, 0.7],
          [-L + 0.4, 1.18],
          [L * 0.12, 1.2],
          [L * 0.52, 0.72],
        ],
        bodyWidth: w,
        cabinWidth: w * 0.84,
        roofThickness: 0.06,
      };
  }
}

function extrudeProfile(profile: Profile, width: number, bevel = 0.05): BufferGeometry {
  const shape = new Shape();
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  return geo;
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export interface WheelVisual {
  /** Positioned at the wheel centre; rotates for steering. */
  pivot: Group;
  /** Rotates around X for wheel spin. */
  spinner: Group;
}

/**
 * Procedural low-poly car built from extruded side profiles. The root is placed at the
 * physics body's centre of mass; wheels are positioned from suspension compression.
 */
export class CarModel {
  readonly root = new Group();
  readonly body = new Group();
  readonly wheels: WheelVisual[] = [];
  readonly paint: MeshStandardMaterial;
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly brakeMat: MeshBasicMaterial;
  private readonly headMat: MeshBasicMaterial;
  private readonly flames: Mesh[] = [];
  readonly shadow: Mesh;
  headlight: SpotLight | null = null;
  readonly bodyBaseY: number;

  constructor(
    readonly car: CarDef,
    color: string,
  ) {
    const p = car.physics;
    this.root.name = `car:${car.id}`;
    this.root.add(this.body);
    this.paint = this.track(
      new MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.25, flatShading: true }),
    );
    const accent = this.track(
      new MeshStandardMaterial({
        color: car.look.accent,
        roughness: 0.7,
        metalness: 0.1,
        flatShading: true,
      }),
    );
    const glass = this.track(
      new MeshStandardMaterial({
        color: '#1d2a38',
        roughness: 0.15,
        metalness: 0.6,
        flatShading: true,
      }),
    );
    const dark = this.track(new MeshLambertMaterial({ color: '#202226', flatShading: true }));
    this.brakeMat = this.track(new MeshBasicMaterial({ color: '#7a0d0d' }));
    this.headMat = this.track(new MeshBasicMaterial({ color: '#fff3c4' }));

    const spec = bodySpec(car);
    // Body base: a bit above the static wheel centre so the wheels sit in the arches.
    const staticCompression = (p.mass * 15) / 4 / p.suspension.stiffness;
    const wheelCenterY = p.mountY - (p.suspension.restLength - staticCompression);
    this.bodyBaseY = wheelCenterY - p.wheelRadius * 0.15;
    const base = this.bodyBaseY;

    const lower = this.geo(extrudeProfile(spec.lower, spec.bodyWidth, 0.06));
    this.add(new Mesh(lower, this.paint), 0, base, 0);
    if (spec.cabin) {
      const cabin = this.geo(extrudeProfile(spec.cabin, spec.cabinWidth, 0.04));
      this.add(new Mesh(cabin, glass), 0, base, 0);
      // Roof panel in body colour.
      const top = spec.cabin.reduce((m, [, y]) => Math.max(m, y), 0);
      const zs = spec.cabin.filter(([, y]) => y > top - 0.05).map(([z]) => z);
      const roofLen = Math.max(...zs) - Math.min(...zs) + 0.1;
      const roof = this.geo(
        new BoxGeometry(spec.cabinWidth * 0.98, spec.roofThickness * 2, roofLen),
      );
      this.add(new Mesh(roof, this.paint), 0, base + top, (Math.max(...zs) + Math.min(...zs)) / 2);
    }
    // Fender flares over each wheel.
    const L = p.chassis.length / 2;
    for (const z of [p.wheelbase / 2, -p.wheelbase / 2]) {
      for (const side of [-1, 1]) {
        const flare = this.geo(
          new BoxGeometry(car.look.wheelWidth + 0.1, 0.12, p.wheelRadius * 2.3),
        );
        this.add(
          new Mesh(flare, accent),
          side * (p.trackWidth / 2 + 0.02),
          wheelCenterY + p.wheelRadius + 0.08,
          z,
        );
      }
    }
    // Bumpers, lights, details.
    const bumperW = spec.bodyWidth * 0.95;
    this.add(
      new Mesh(this.geo(new BoxGeometry(bumperW, 0.2, 0.22)), accent),
      0,
      base + 0.2,
      L + 0.04,
    );
    this.add(
      new Mesh(this.geo(new BoxGeometry(bumperW, 0.2, 0.22)), accent),
      0,
      base + 0.2,
      -L - 0.04,
    );
    for (const side of [-1, 1]) {
      this.add(
        new Mesh(this.geo(new BoxGeometry(0.34, 0.14, 0.08)), this.headMat),
        side * spec.bodyWidth * 0.33,
        base + 0.45,
        L + 0.05,
      );
      this.add(
        new Mesh(this.geo(new BoxGeometry(0.32, 0.12, 0.06)), this.brakeMat),
        side * spec.bodyWidth * 0.36,
        base + 0.52,
        -L - 0.03,
      );
    }
    if (car.look.body === 'rally' || car.look.body === 'coupe') {
      // Racing stripe.
      const stripe = this.geo(new BoxGeometry(0.28, 0.02, L * 1.1));
      this.add(
        new Mesh(stripe, accent),
        0.22,
        base + 0.74 + (car.look.body === 'coupe' ? -0.08 : 0),
        L * 0.45,
      );
    }
    if (car.look.spoiler) {
      const wing = this.geo(new BoxGeometry(spec.bodyWidth * 0.95, 0.06, 0.38));
      const h = car.look.body === 'coupe' ? 0.92 : 1.12;
      this.add(new Mesh(wing, accent), 0, base + h, -L + 0.18);
      for (const side of [-1, 1])
        this.add(
          new Mesh(this.geo(new BoxGeometry(0.06, 0.24, 0.12)), accent),
          side * 0.5,
          base + h - 0.14,
          -L + 0.2,
        );
    }
    if (car.look.body === 'buggy') {
      // Roll cage, seat and engine block.
      const tube = (len: number): BufferGeometry =>
        this.geo(new CylinderGeometry(0.05, 0.05, len, 5));
      for (const side of [-1, 1]) {
        const a = new Mesh(tube(1.0), dark);
        a.rotation.x = 0.35;
        this.add(a, side * 0.6, base + 1.0, 0.25);
        const b = new Mesh(tube(1.0), dark);
        b.rotation.x = -0.25;
        this.add(b, side * 0.6, base + 1.0, -0.6);
      }
      const top = new Mesh(tube(1.24), dark);
      top.rotation.z = Math.PI / 2;
      this.add(top, 0, base + 1.48, -0.05);
      this.add(new Mesh(this.geo(new BoxGeometry(0.55, 0.5, 0.5)), accent), 0, base + 0.8, -0.2);
      this.add(new Mesh(this.geo(new BoxGeometry(0.9, 0.35, 0.7)), dark), 0, base + 0.75, -L + 0.5);
    }
    if (car.look.body === 'truck') {
      // Pickup bed walls.
      const bedLen = L + 0.15;
      for (const side of [-1, 1])
        this.add(
          new Mesh(this.geo(new BoxGeometry(0.08, 0.3, bedLen)), this.paint),
          side * (spec.bodyWidth / 2 - 0.06),
          base + 1.0,
          -L + bedLen / 2,
        );
      this.add(
        new Mesh(this.geo(new BoxGeometry(spec.bodyWidth - 0.1, 0.3, 0.08)), this.paint),
        0,
        base + 1.0,
        -L + 0.02,
      );
    }
    if (car.look.roofRack) {
      this.add(
        new Mesh(this.geo(new BoxGeometry(spec.cabinWidth * 0.9, 0.06, 0.9)), dark),
        0,
        base + 1.72,
        L * 0.18,
      );
      for (let i = 0; i < 4; i++) {
        const lamp = new Mesh(this.geo(new CylinderGeometry(0.09, 0.09, 0.08, 8)), this.headMat);
        lamp.rotation.x = Math.PI / 2;
        this.add(lamp, (i - 1.5) * 0.36, base + 1.82, L * 0.18 + 0.4);
      }
    }
    // Exhaust nitro flames.
    const flameGeo = this.geo(new ConeGeometry(0.11, 0.9, 6));
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.translate(0, 0, -0.45);
    const flameMat = this.track(
      new MeshBasicMaterial({
        color: '#6fd3ff',
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    for (const side of [-1, 1]) {
      const f = new Mesh(flameGeo, flameMat);
      f.visible = false;
      this.add(f, side * 0.35, base + 0.22, -L - 0.1);
      this.flames.push(f);
    }
    this.body.traverse((o) => {
      if ((o as Mesh).isMesh && !this.flames.includes(o as Mesh)) {
        o.castShadow = true;
      }
    });

    // Wheels.
    const tyre = this.track(new MeshLambertMaterial({ color: '#1b1c1f', flatShading: true }));
    const rim = this.track(
      new MeshStandardMaterial({
        color: '#c9ced6',
        roughness: 0.35,
        metalness: 0.7,
        flatShading: true,
      }),
    );
    const r = p.wheelRadius;
    const ww = car.look.wheelWidth;
    const tyreGeo = this.geo(new CylinderGeometry(r, r, ww, 12).rotateZ(Math.PI / 2));
    const rimGeo = this.geo(
      new CylinderGeometry(r * 0.62, r * 0.62, ww + 0.02, 6).rotateZ(Math.PI / 2),
    );
    const spokeGeo = this.geo(new BoxGeometry(ww + 0.03, r * 1.15, 0.07));
    for (let i = 0; i < 4; i++) {
      const pivot = new Group();
      const spinner = new Group();
      pivot.add(spinner);
      const t = new Mesh(tyreGeo, tyre);
      t.castShadow = true;
      spinner.add(t, new Mesh(rimGeo, rim));
      for (let k = 0; k < 3; k++) {
        const s = new Mesh(spokeGeo, rim);
        s.rotation.x = (k * Math.PI) / 3;
        spinner.add(s);
      }
      this.root.add(pivot);
      this.wheels.push({ pivot, spinner });
    }

    // Blob shadow (world aligned; positioned by the owner).
    const shadowTex = shadowTexture();
    const shadowMat = this.track(
      new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    this.shadow = new Mesh(
      this.geo(
        new PlaneGeometry(p.chassis.width * 1.5, p.chassis.length * 1.25).rotateX(-Math.PI / 2),
      ),
      shadowMat,
    );
    this.shadow.renderOrder = 1;
    shadowTex.dispose = shadowTex.dispose.bind(shadowTex);
    this.disposeExtra.push(shadowTex);
  }

  private readonly disposeExtra: { dispose(): void }[] = [];

  private track<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private add(o: Object3D, x: number, y: number, z: number): void {
    o.position.set(x, y, z);
    this.body.add(o);
  }

  setColor(color: string): void {
    this.paint.color.set(color);
  }

  /** Night/dawn headlight spot (no shadows, cheap). */
  enableHeadlights(on: boolean): void {
    this.headMat.color.set(on ? '#fffbe8' : '#e8dcb0');
    if (on && !this.headlight) {
      const L = this.car.physics.chassis.length / 2;
      const spot = new SpotLight('#fff3d6', 60, 90, 0.55, 0.5, 1.4);
      spot.position.set(0, this.bodyBaseY + 0.5, L);
      const target = new Object3D();
      target.position.set(0, this.bodyBaseY - 1.5, L + 20);
      this.body.add(target);
      spot.target = target;
      this.body.add(spot);
      this.headlight = spot;
    }
    if (this.headlight) this.headlight.visible = on;
  }

  setBraking(on: boolean): void {
    this.brakeMat.color.set(on ? '#ff2a2a' : '#7a0d0d');
  }

  setNitro(on: boolean, time: number): void {
    for (const f of this.flames) {
      f.visible = on;
      if (on) f.scale.set(1, 1, 0.8 + Math.sin(time * 60 + f.position.x * 10) * 0.25);
    }
  }

  /** Static pose for menus/garage: wheels at rest. */
  setRestPose(): void {
    const p = this.car.physics;
    const compression = (p.mass * 15) / 4 / p.suspension.stiffness;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      this.wheels[i].pivot.position.set(
        ((left ? 1 : -1) * p.trackWidth) / 2,
        p.mountY - (p.suspension.restLength - compression),
        ((front ? 1 : -1) * p.wheelbase) / 2,
      );
    }
  }

  dispose(): void {
    this.headlight?.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.disposeExtra.forEach((d) => d.dispose());
    this.root.removeFromParent();
    this.shadow.removeFromParent();
  }
}

export const tmpColor = new Color();
