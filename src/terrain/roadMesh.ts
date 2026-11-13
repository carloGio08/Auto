import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config } from '../config';
import { surfaces } from '../data/surfaces';
import { ROAD_BRIDGE, SURFACE_IDS } from './road';
import type { Course } from './course';

const LATERAL = [-1.12, -0.7, -0.35, 0, 0.35, 0.7, 1.12];

/** Builds the road ribbon (textured, tinted per surface) and bridge decks with supports. */
export function buildRoadMeshes(course: Course, roadTex: Texture, plankTex: Texture): Group {
  const group = new Group();
  group.name = 'road';
  const road = course.road;
  const terrain = course.terrain;
  const n = road.count;
  const cols = LATERAL.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tint = new Color();
  const base = new Color('#b89a78');
  let vert = 0;
  let prevRowStart = -1;
  for (let i = 0; i < n; i++) {
    const bridge = (road.flags[i] & ROAD_BRIDGE) !== 0;
    if (bridge) {
      prevRowStart = -1;
      continue;
    }
    const hw = road.halfWidth[i];
    const nx = road.tz[i];
    const nz = -road.tx[i];
    const surf = surfaces[SURFACE_IDS[road.surface[i]]];
    tint.set(surf.color).lerp(base, 0.35);
    const rowStart = vert;
    for (let c = 0; c < cols; c++) {
      const lat = LATERAL[c] * hw;
      const x = road.x[i] + nx * lat;
      const z = road.z[i] + nz * lat;
      const y =
        terrain.groundHeight(x, z, road.y[i] + 2) +
        config.world.roadOffset +
        (Math.abs(LATERAL[c]) > 1 ? -0.03 : 0);
      positions.push(x, y, z);
      // Darken the outer edge slightly so the road blends into the shoulder.
      const edge = Math.abs(LATERAL[c]) > 1 ? 0.82 : 1;
      colors.push(tint.r * edge, tint.g * edge, tint.b * edge);
      uvs.push((LATERAL[c] + 1.12) / 2.24, (i * road.spacing) / 9);
      vert++;
    }
    if (prevRowStart >= 0) {
      for (let c = 0; c < cols - 1; c++) {
        const a = prevRowStart + c;
        const b = prevRowStart + c + 1;
        const d = rowStart + c;
        const e = rowStart + c + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    prevRowStart = rowStart;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new MeshLambertMaterial({
    map: roadTex,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ribbon = new Mesh(geo, mat);
  ribbon.receiveShadow = true;
  ribbon.name = 'roadRibbon';
  group.add(ribbon);

  // Bridges: plank deck, beams and pillars down to the river bed.
  const deckParts: BufferGeometry[] = [];
  const beamParts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  for (const b of road.bridges) {
    const i0 = Math.round(b.from / road.spacing);
    const i1 = Math.round(b.to / road.spacing);
    for (let i = i0; i < i1; i++) {
      const hw = road.halfWidth[i] + 0.25;
      const x0 = road.x[i];
      const z0 = road.z[i];
      const x1 = road.x[i + 1];
      const z1 = road.z[i + 1];
      const y0 = road.y[i];
      const y1 = road.y[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
      dir.set(x1 - x0, y1 - y0, z1 - z0).normalize();
      const heading = Math.atan2(dir.x, dir.z);
      q.setFromAxisAngle(up, heading);
      const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.asin(dir.y));
      q.multiply(pitch);
      const deck = new BoxGeometry(hw * 2, 0.35, len + 0.05);
      m.compose(
        new Vector3((x0 + x1) / 2, (y0 + y1) / 2 - 0.17, (z0 + z1) / 2),
        q,
        new Vector3(1, 1, 1),
      );
      deck.applyMatrix4(m);
      deckParts.push(deck);
      if ((i - i0) % 3 === 0) {
        for (const side of [-1, 1]) {
          const px = x0 + road.tz[i] * side * (hw - 0.3);
          const pz = z0 - road.tx[i] * side * (hw - 0.3);
          const ground = terrain.height(px, pz);
          const h = Math.max(0.5, y0 - ground + 1);
          const pillar = new CylinderGeometry(0.28, 0.36, h, 6);
          pillar.translate(px, y0 - 0.3 - h / 2, pz);
          beamParts.push(pillar);
        }
        const cross = new BoxGeometry(hw * 2 + 0.4, 0.4, 0.4);
        m.compose(
          new Vector3(x0, y0 - 0.55, z0),
          new Quaternion().setFromAxisAngle(up, heading),
          new Vector3(1, 1, 1),
        );
        cross.applyMatrix4(m);
        beamParts.push(cross);
      }
    }
  }
  if (deckParts.length) {
    const deckGeo = mergeGeometries(deckParts);
    deckParts.forEach((g) => g.dispose());
    // Planks run across the deck: remap UVs from world position.
    const p = deckGeo.getAttribute('position');
    const uvAttr = deckGeo.getAttribute('uv');
    for (let i = 0; i < p.count; i++)
      uvAttr.setXY(i, p.getX(i) * 0.25 + p.getZ(i) * 0.05, (p.getX(i) + p.getZ(i)) * 0.6);
    const deck = new Mesh(deckGeo, new MeshLambertMaterial({ map: plankTex }));
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    const beamGeo = mergeGeometries(beamParts);
    beamParts.forEach((g) => g.dispose());
    const beams = new Mesh(
      beamGeo,
      new MeshLambertMaterial({ color: '#5a3f27', flatShading: true }),
    );
    beams.castShadow = true;
    group.add(beams);
  }
  return group;
}
