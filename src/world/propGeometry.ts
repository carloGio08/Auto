import type { BufferGeometry } from 'three';
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  BoxGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../math/rng';

/** Paints a whole (non-indexed) geometry with one colour plus slight per-face jitter. */
function paint(geo: BufferGeometry, color: string, jitter = 0.08, seed = 1): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const c = new Color(color);
  const rng = new Rng(seed);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    const k = 1 - jitter / 2 + rng.next() * jitter;
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r * k;
      colors[(i + v) * 3 + 1] = c.g * k;
      colors[(i + v) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Randomly displaces vertices (keeps shared positions consistent) for organic shapes. */
function wobble(geo: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const rng = new Rng(seed);
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = cache.get(key);
    if (!d) {
      d = [
        rng.range(-amount, amount),
        rng.range(-amount, amount) * 0.6,
        rng.range(-amount, amount),
      ];
      cache.set(key, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  return geo;
}

/** Tall pine: trunk + stacked cones. `snow` adds white caps. Origin at the trunk base. */
export function pineGeometry(variant: number, snow = false): BufferGeometry {
  const rng = new Rng(100 + variant);
  const tiers = 3 + (variant % 2);
  const height = 7 + variant * 1.2;
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.18, 0.3, height * 0.35, 5);
  trunk.translate(0, height * 0.175, 0);
  parts.push(paint(trunk, '#6b4a30', 0.1, variant));
  const greens = ['#2f5d34', '#356b3a', '#2b5530', '#3b7140'];
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const r = (2.3 - f * 1.5) * (0.9 + rng.next() * 0.2);
    const h = height * 0.42 * (1 - f * 0.25);
    const cone = new ConeGeometry(r, h, 6 + (variant % 2), 1);
    cone.rotateY(rng.next() * Math.PI);
    cone.translate(0, height * 0.28 + f * height * 0.55 + h / 2, 0);
    wobble(cone, 0.18, variant * 7 + t);
    parts.push(paint(cone, greens[(variant + t) % greens.length], 0.12, variant * 10 + t));
    if (snow) {
      const cap = new ConeGeometry(r * 0.62, h * 0.4, 6, 1);
      cap.translate(0, height * 0.28 + f * height * 0.55 + h * 0.82, 0);
      parts.push(paint(cap, '#eef3f7', 0.05, t));
    }
  }
  return merge(parts);
}

/** Rounder broadleaf tree for lower altitudes. */
export function roundTreeGeometry(variant: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.2, 0.32, 3.2, 5);
  trunk.translate(0, 1.6, 0);
  parts.push(paint(trunk, '#6e4b2e', 0.1, variant));
  const rng = new Rng(300 + variant);
  const greens = ['#4f8a3a', '#5c963f', '#467d34'];
  for (let i = 0; i < 3; i++) {
    const r = 1.4 + rng.next() * 0.8;
    const blob = new IcosahedronGeometry(r, 0);
    wobble(blob, 0.25, variant * 5 + i);
    blob.translate(rng.range(-0.8, 0.8), 3.6 + i * 0.9 + rng.next() * 0.4, rng.range(-0.8, 0.8));
    parts.push(paint(blob, greens[(i + variant) % greens.length], 0.14, variant + i));
  }
  return merge(parts);
}

export function bushGeometry(variant: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rng = new Rng(500 + variant);
  const greens = ['#4d7f35', '#5a8c3b', '#6b8f3a'];
  for (let i = 0; i < 2 + variant; i++) {
    const blob = new IcosahedronGeometry(0.6 + rng.next() * 0.4, 0);
    wobble(blob, 0.12, variant * 3 + i);
    blob.scale(1, 0.75, 1);
    blob.translate(rng.range(-0.5, 0.5), 0.4, rng.range(-0.5, 0.5));
    parts.push(paint(blob, greens[i % greens.length], 0.15, i + variant));
  }
  return merge(parts);
}

/** Irregular rock; base slightly sunk below the origin. */
export function rockGeometry(variant: number, color = '#8a857e'): BufferGeometry {
  const g = new DodecahedronGeometry(1, variant % 2);
  wobble(g, 0.28, 900 + variant);
  g.scale(1.2, 0.75 + (variant % 3) * 0.12, 1);
  g.translate(0, 0.35, 0);
  return merge([paint(g, color, 0.18, variant)]);
}

export function logGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const body = new CylinderGeometry(0.42, 0.45, 7, 7);
  body.rotateZ(Math.PI / 2);
  parts.push(paint(body, '#6a4529', 0.1, 1));
  for (const s of [-1, 1]) {
    const cap = new CylinderGeometry(0.4, 0.4, 0.05, 7);
    cap.rotateZ(Math.PI / 2);
    cap.translate(s * 3.51, 0, 0);
    parts.push(paint(cap, '#c8a173', 0.05, 2));
  }
  const g = merge(parts);
  g.translate(0, 0.42, 0);
  return g;
}

/** Post-and-rail wooden fence segment, 4 m long along +X, origin at the start post. */
export function fenceGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const post = new BoxGeometry(0.16, 1.2, 0.16);
  post.translate(0, 0.6, 0);
  parts.push(paint(post, '#7a5434', 0.1, 3));
  for (const y of [0.45, 0.95]) {
    const rail = new BoxGeometry(4, 0.12, 0.08);
    rail.translate(2, y, 0);
    parts.push(paint(rail, '#8d6440', 0.1, Math.round(y * 10)));
  }
  return merge(parts);
}

/** Metal guardrail segment, 4 m long along +X. */
export function guardrailGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const post = new BoxGeometry(0.12, 0.85, 0.12);
  post.translate(0, 0.42, 0);
  parts.push(paint(post, '#6d737a', 0.05, 4));
  const rail = new BoxGeometry(4.05, 0.32, 0.06);
  rail.translate(2, 0.68, 0.06);
  parts.push(paint(rail, '#c7cdd3', 0.04, 5));
  const stripe = new BoxGeometry(0.5, 0.33, 0.065);
  stripe.translate(2, 0.68, 0.065);
  parts.push(paint(stripe, '#e23b2e', 0.02, 6));
  return merge(parts);
}
