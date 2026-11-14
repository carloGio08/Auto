import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  Shape,
  SpotLight,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDef } from '../data/types';

type Profile = [number, number][];

/** Extrudes a side profile (z forward, y up) across the car width, centred on x = 0. */
function extrudeProfile(profile: Profile, width: number, bevel = 0.04): BufferGeometry {
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

/** Chunky off-road tyre: low-poly drum with alternating tread blocks on both shoulders. */
function knobbyTyre(r: number, w: number): BufferGeometry {
  const parts: BufferGeometry[] = [new CylinderGeometry(r * 0.94, r * 0.94, w, 12)];
  const knobs = 14;
  for (let i = 0; i < knobs; i++) {
    const a = (i / knobs) * Math.PI * 2;
    const k = new BoxGeometry(w * 0.46, r * 0.12, r * 0.3);
    k.translate((i % 2 ? 1 : -1) * w * 0.26, r * 0.96, 0);
    k.rotateX(a);
    parts.push(k);
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  parts.forEach((p) => p.dispose());
  g.rotateZ(Math.PI / 2);
  return g;
}

export interface WheelVisual {
  /** Positioned at the wheel centre; rotates for steering. */
  pivot: Group;
  /** Rotates around X for wheel spin. */
  spinner: Group;
}

/** A rod (half-shaft, coil-over) stretched between a fixed body point and a wheel hub. */
interface Link {
  mesh: Mesh;
  wheel: number;
  /** Fixed end in the root frame. */
  anchor: Vector3;
  /** Fraction of the way from the hub towards the anchor where the rod ends at the hub. */
  hubInset: number;
  /** Extra lift of the hub end (m). */
  hubLift: number;
}

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();

/**
 * Procedural low-poly 4x4: boxy tub with a flat hood, round headlights, wide flat fender
 * flares, a straight windshield, rollbar, rear spare wheel, roof rack with jerrycans and a
 * backpack, knobby tyres and a visible independent suspension (half-shafts from the
 * differentials and coil-overs, re-aimed every frame). Few flat colours, no textures.
 * The root sits at the physics body's centre of mass.
 */
export class CarModel {
  readonly root = new Group();
  readonly body = new Group();
  readonly wheels: WheelVisual[] = [];
  readonly paint: MeshLambertMaterial;
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly brakeMat: MeshBasicMaterial;
  private readonly headMat: MeshBasicMaterial;
  private readonly flames: Mesh[] = [];
  private readonly links: Link[] = [];
  /** Low-poly contact shadow (world aligned; positioned by the owner). */
  readonly shadow: Mesh;
  headlight: SpotLight | null = null;
  readonly bodyBaseY: number;

  constructor(
    readonly car: CarDef,
    color: string,
  ) {
    const p = car.physics;
    const look = car.look;
    this.root.name = `car:${car.id}`;
    this.root.add(this.body);
    const flat = (c: string): MeshLambertMaterial =>
      this.track(new MeshLambertMaterial({ color: c, flatShading: true }));
    this.paint = flat(color);
    const accent = flat(look.accent);
    const glass = flat('#2b3e52');
    const metal = flat('#9aa1a8');
    const dark = flat('#1d1f22');
    const coil = flat('#e0a530');
    const canvasMat = flat('#7d6a48');
    const canMat = flat('#b8402f');
    const canMat2 = flat('#5d6b3a');
    this.brakeMat = this.track(new MeshBasicMaterial({ color: '#7a0d0d' }));
    this.headMat = this.track(new MeshBasicMaterial({ color: '#f3e7bd' }));

    // Body base a bit above the static wheel centre: high clearance, wheels in the arches.
    const staticCompression = (p.mass * 15) / 4 / p.suspension.stiffness;
    const wheelCenterY = p.mountY - (p.suspension.restLength - staticCompression);
    this.bodyBaseY = wheelCenterY + p.wheelRadius * 0.05;
    const base = this.bodyBaseY;
    const L = p.chassis.length / 2;
    const W = p.trackWidth - 0.08;
    const belt = 0.82;
    const hoodY = 0.86;
    const shieldZ = look.body === 'short' ? L * 0.2 : L * 0.28;
    const cabinBack = look.body === 'long' ? shieldZ - 1.45 : -L + 0.15;

    // Tub: flat hood, slightly sloped grille, vertical tailgate.
    const lower = this.geo(
      extrudeProfile(
        [
          [-L, 0.18],
          [-L, belt],
          [shieldZ, belt],
          [shieldZ + 0.08, hoodY],
          [L - 0.08, hoodY],
          [L, hoodY - 0.08],
          [L + 0.04, 0.22],
          [L - 0.12, 0.12],
          [-L + 0.12, 0.12],
        ],
        W,
      ),
    );
    this.add(new Mesh(lower, this.paint), 0, base, 0);
    // Darker skid plate and side steps.
    this.add(new Mesh(this.geo(new BoxGeometry(W * 0.7, 0.08, L * 1.5)), dark), 0, base + 0.1, 0);
    // Grille slots and round headlights with accent bezels.
    for (let i = -2; i <= 2; i++)
      this.add(
        new Mesh(this.geo(new BoxGeometry(0.07, 0.34, 0.04)), dark),
        i * 0.13,
        base + 0.55,
        L + 0.03,
      );
    const lampGeo = this.geo(new CylinderGeometry(0.13, 0.13, 0.06, 10).rotateX(Math.PI / 2));
    const bezelGeo = this.geo(new CylinderGeometry(0.17, 0.17, 0.05, 10).rotateX(Math.PI / 2));
    for (const side of [-1, 1]) {
      this.add(new Mesh(bezelGeo, accent), side * W * 0.34, base + 0.6, L + 0.01);
      this.add(new Mesh(lampGeo, this.headMat), side * W * 0.34, base + 0.6, L + 0.04);
      this.add(
        new Mesh(this.geo(new BoxGeometry(0.14, 0.22, 0.05)), this.brakeMat),
        side * (W / 2 - 0.12),
        base + 0.62,
        -L - 0.02,
      );
    }
    // Bumpers (steel tube look) with a winch block at the front.
    this.add(
      new Mesh(this.geo(new BoxGeometry(W + 0.2, 0.18, 0.24)), accent),
      0,
      base + 0.24,
      L + 0.1,
    );
    this.add(new Mesh(this.geo(new BoxGeometry(0.4, 0.16, 0.14)), dark), 0, base + 0.24, L + 0.27);
    this.add(
      new Mesh(this.geo(new BoxGeometry(W + 0.12, 0.16, 0.2)), accent),
      0,
      base + 0.24,
      -L - 0.08,
    );

    // Wide flat fender flares (trapezoid arches) over each wheel.
    const r = p.wheelRadius;
    const flareProfile: Profile = [
      [-r * 1.25, 0],
      [-r * 0.85, r * 0.55],
      [r * 0.85, r * 0.55],
      [r * 1.25, 0],
      [r * 1.1, 0],
      [r * 0.75, r * 0.42],
      [-r * 0.75, r * 0.42],
      [-r * 1.1, 0],
    ];
    const flareGeo = this.geo(extrudeProfile(flareProfile, look.wheelWidth + 0.16, 0.02));
    for (const z of [p.wheelbase / 2, -p.wheelbase / 2])
      for (const side of [-1, 1])
        this.add(
          new Mesh(flareGeo, accent),
          side * (p.trackWidth / 2 - 0.02),
          wheelCenterY + r * 0.62,
          z,
        );

    // Straight windshield: frame + glass, folded upright.
    const shieldH = 0.62;
    const frame = this.geo(new BoxGeometry(W - 0.04, shieldH, 0.08));
    const shield = new Group();
    shield.add(new Mesh(frame, accent));
    const pane = new Mesh(this.geo(new BoxGeometry(W - 0.24, shieldH - 0.16, 0.1)), glass);
    shield.add(pane);
    shield.rotation.x = -0.12;
    this.add(shield, 0, base + belt + shieldH / 2 + 0.02, shieldZ + 0.02);
    // Seats.
    for (const side of [-1, 1]) {
      this.add(
        new Mesh(this.geo(new BoxGeometry(0.46, 0.5, 0.12)), dark),
        side * 0.38,
        base + belt + 0.12,
        shieldZ - 0.95,
      );
    }
    // Rollbar: two hoops and side rails.
    const rollH = 0.72;
    const tube = (len: number): BufferGeometry =>
      this.geo(new CylinderGeometry(0.045, 0.045, len, 6));
    const hoopZ = [shieldZ - 1.2];
    if (cabinBack + 0.1 < shieldZ - 1.7) hoopZ.push(cabinBack + 0.1);
    const rackBack = hoopZ[hoopZ.length - 1];
    for (const z of hoopZ) {
      for (const side of [-1, 1])
        this.add(new Mesh(tube(rollH), accent), side * (W / 2 - 0.1), base + belt + rollH / 2, z);
      const top = new Mesh(tube(W - 0.2), accent);
      top.rotation.z = Math.PI / 2;
      this.add(top, 0, base + belt + rollH, z);
    }
    for (const side of [-1, 1]) {
      const rail = new Mesh(tube(shieldZ - rackBack), accent);
      rail.rotation.x = Math.PI / 2;
      this.add(rail, side * (W / 2 - 0.1), base + belt + rollH, (shieldZ + rackBack) / 2);
    }
    const roofY = base + belt + rollH;

    if (look.body === 'long') {
      // Pickup bed walls behind the cabin.
      const bedLen = cabinBack + L;
      for (const side of [-1, 1])
        this.add(
          new Mesh(this.geo(new BoxGeometry(0.08, 0.26, bedLen)), this.paint),
          side * (W / 2 - 0.04),
          base + belt + 0.13,
          -L + bedLen / 2,
        );
      this.add(
        new Mesh(this.geo(new BoxGeometry(W, 0.26, 0.08)), this.paint),
        0,
        base + belt + 0.13,
        -L + 0.04,
      );
    }

    if (look.roofRack) {
      // Ladder rack on the rollbar with jerrycans and a backpack.
      const rackLen = shieldZ - rackBack + 0.1;
      const rackZ = (shieldZ + rackBack) / 2;
      for (const side of [-1, 1])
        this.add(
          new Mesh(this.geo(new BoxGeometry(0.06, 0.06, rackLen)), dark),
          side * (W / 2 - 0.16),
          roofY + 0.08,
          rackZ,
        );
      for (let i = 0; i < 4; i++)
        this.add(
          new Mesh(this.geo(new BoxGeometry(W - 0.3, 0.04, 0.06)), dark),
          0,
          roofY + 0.08,
          rackBack + (i / 3) * (rackLen - 0.1),
        );
      if (look.cargo) {
        const can = this.geo(new BoxGeometry(0.2, 0.42, 0.34));
        this.add(new Mesh(can, canMat), -W * 0.22, roofY + 0.31, rackZ - 0.25);
        this.add(new Mesh(can, canMat2), -W * 0.22 + 0.22, roofY + 0.31, rackZ - 0.25);
        const pack = this.geo(new OctahedronGeometry(0.3, 1));
        pack.scale(1.1, 0.7, 0.8);
        this.add(new Mesh(pack, canvasMat), W * 0.2, roofY + 0.28, rackZ + 0.15);
      }
    } else if (look.cargo) {
      const can = this.geo(new BoxGeometry(0.2, 0.42, 0.34));
      this.add(new Mesh(can, canMat), W * 0.25, base + belt + 0.21, cabinBack - 0.3);
    }
    if (look.lightBar) {
      const lb = this.geo(new BoxGeometry(W * 0.7, 0.12, 0.12));
      const lbZ = shieldZ - 0.2;
      this.add(new Mesh(lb, dark), 0, roofY + 0.14, lbZ);
      for (let i = 0; i < 4; i++) {
        const lamp = new Mesh(lampGeo, this.headMat);
        lamp.scale.set(0.45, 0.45, 1);
        this.add(lamp, (i - 1.5) * W * 0.17, roofY + 0.14, lbZ + 0.06);
      }
    }
    if (look.snorkel) {
      const sn = new Mesh(tube(0.9), dark);
      this.add(sn, W / 2 + 0.02, base + belt + 0.3, shieldZ + 0.05);
      const cap = new Mesh(this.geo(new BoxGeometry(0.14, 0.12, 0.2)), dark);
      this.add(cap, W / 2 + 0.02, base + belt + 0.76, shieldZ + 0.12);
    }

    // Wheels (and the spare one on the tailgate).
    const ww = look.wheelWidth;
    const tyreGeo = this.geo(knobbyTyre(r, ww));
    const rimGeo = this.geo(
      new CylinderGeometry(r * 0.58, r * 0.58, ww + 0.02, 6).rotateZ(Math.PI / 2),
    );
    const hubGeo = this.geo(
      new CylinderGeometry(r * 0.2, r * 0.2, ww + 0.06, 6).rotateZ(Math.PI / 2),
    );
    const tyreMat = flat('#24262a');
    if (look.spareWheel) {
      const spare = new Group();
      spare.add(new Mesh(tyreGeo, tyreMat), new Mesh(rimGeo, metal));
      spare.rotation.y = Math.PI / 2;
      this.add(spare, 0, base + belt * 0.55, -L - ww / 2 - 0.05);
    }
    for (let i = 0; i < 4; i++) {
      const pivot = new Group();
      const spinner = new Group();
      pivot.add(spinner);
      const t = new Mesh(tyreGeo, tyreMat);
      t.castShadow = true;
      spinner.add(t, new Mesh(rimGeo, metal), new Mesh(hubGeo, accent));
      this.root.add(pivot);
      this.wheels.push({ pivot, spinner });
    }

    // Independent suspension: differentials, half-shafts and coil-overs.
    const shaftGeo = this.geo(new CylinderGeometry(0.05, 0.05, 1, 6));
    shaftGeo.translate(0, 0.5, 0);
    const coilGeo = this.geo(new CylinderGeometry(0.09, 0.09, 1, 6));
    coilGeo.translate(0, 0.5, 0);
    const diffY = wheelCenterY + 0.05;
    for (const z of [p.wheelbase / 2, -p.wheelbase / 2]) {
      this.add(new Mesh(this.geo(new OctahedronGeometry(0.2, 0)), dark), 0, diffY, z);
    }
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      const sx = left ? 1 : -1;
      const z = ((front ? 1 : -1) * p.wheelbase) / 2;
      const shaft = new Mesh(shaftGeo, dark);
      const spring = new Mesh(coilGeo, coil);
      this.root.add(shaft, spring);
      this.links.push(
        {
          mesh: shaft,
          wheel: i,
          anchor: new Vector3(sx * 0.16, diffY, z),
          hubInset: 0,
          hubLift: 0,
        },
        {
          mesh: spring,
          wheel: i,
          anchor: new Vector3(
            sx * (p.trackWidth / 2 - 0.42),
            base + 0.62,
            z + (front ? -0.08 : 0.08),
          ),
          hubInset: 0.22,
          hubLift: 0.06,
        },
      );
    }

    // Nitro flames out of the rear exhaust.
    const flameGeo = this.geo(new ConeGeometry(0.1, 0.9, 5));
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
    const f = new Mesh(flameGeo, flameMat);
    f.visible = false;
    this.add(f, -W * 0.3, base + 0.18, -L - 0.12);
    this.flames.push(f);

    this.body.traverse((o) => {
      if ((o as Mesh).isMesh && !this.flames.includes(o as Mesh)) o.castShadow = true;
    });

    // Contact shadow: a soft dark octagon (no texture).
    const shadowMat = this.track(
      new MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        depthWrite: false,
        opacity: 0.3,
      }),
    );
    const sg = this.geo(new CircleGeometry(1, 8).rotateX(-Math.PI / 2));
    sg.scale(p.chassis.width * 0.62, 1, p.chassis.length * 0.56);
    this.shadow = new Mesh(sg, shadowMat);
    this.shadow.renderOrder = 1;
    this.setRestPose();
  }

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

  /** Re-aims half-shafts and coil-overs at the current wheel hub positions. */
  syncLinks(): void {
    for (const l of this.links) {
      const hub = this.wheels[l.wheel].pivot.position;
      tmpA.copy(hub).lerp(l.anchor, l.hubInset);
      tmpA.y += l.hubLift;
      tmpB.copy(l.anchor).sub(tmpA);
      const len = tmpB.length();
      if (len < 1e-4) continue;
      tmpB.multiplyScalar(1 / len);
      tmpQ.setFromUnitVectors(UP, tmpB);
      l.mesh.position.copy(tmpA);
      l.mesh.quaternion.copy(tmpQ);
      l.mesh.scale.set(1, len, 1);
    }
  }

  /** Night/dawn headlight spot (no shadows, cheap). */
  enableHeadlights(on: boolean): void {
    this.headMat.color.set(on ? '#fffbe8' : '#f3e7bd');
    if (on && !this.headlight) {
      const L = this.car.physics.chassis.length / 2;
      const spot = new SpotLight('#fff3d6', 60, 90, 0.55, 0.5, 1.4);
      spot.position.set(0, this.bodyBaseY + 0.6, L);
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
      if (on) f.scale.set(1, 1, 0.8 + Math.sin(time * 60) * 0.25);
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
    this.syncLinks();
  }

  dispose(): void {
    this.headlight?.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.root.removeFromParent();
    this.shadow.removeFromParent();
  }
}
