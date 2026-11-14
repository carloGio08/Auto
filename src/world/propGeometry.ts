import type { BufferGeometry, Color } from 'three';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  Float32BufferAttribute,
  OctahedronGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../math/rng';
import type { ResolvedPalette } from '../data/palette';

/** Paints a (non-indexed) geometry with one colour; `alt` gives some faces the second tone. */
function paint(
  geo: BufferGeometry,
  color: Color,
  alt?: Color,
  altRatio = 0.35,
  seed = 1,
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const rng = new Rng(seed);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    const c = alt && rng.next() < altRatio ? alt : color;
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r;
      colors[(i + v) * 3 + 1] = c.g;
      colors[(i + v) * 3 + 2] = c.b;
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

/** Gently displaces shared vertices for organic, faceted shapes. */
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
        rng.range(-amount, amount) * 0.5,
        rng.range(-amount, amount),
      ];
      cache.set(key, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  return geo;
}

export type TreeTier = 'young' | 'medium' | 'old';

/** Builders for every prop, coloured from the resolved world palette. */
export class PropGeometry {
  constructor(private readonly pal: ResolvedPalette) {}

  private trunk(height: number, radius: number): BufferGeometry {
    const t = new CylinderGeometry(radius * 0.7, radius, height, 5);
    t.translate(0, height / 2, 0);
    return paint(t, this.pal.wood[1]);
  }

  /** Pine of stacked cones. Origin at the trunk base, ~1 m reference trunk radius 0.2. */
  pine(tier: TreeTier, variant: number, snow = false): BufferGeometry {
    const greens = [this.pal.foliage[2], this.pal.foliage[1], this.pal.foliage[0]];
    const tiers = tier === 'young' ? 1 : tier === 'medium' ? 2 : 3;
    const height = tier === 'young' ? 3.2 : tier === 'medium' ? 6.5 : 10.5;
    const parts: BufferGeometry[] = [
      this.trunk(height * 0.3, tier === 'old' ? 0.42 : tier === 'medium' ? 0.28 : 0.16),
    ];
    for (let k = 0; k < tiers; k++) {
      const f = k / tiers;
      const r = (tier === 'young' ? 1.1 : tier === 'medium' ? 2 : 2.8) * (1 - f * 0.32);
      const h = height * (tiers === 1 ? 0.8 : 0.5) * (1 - f * 0.2);
      const cone = new ConeGeometry(r, h, 6, 1);
      cone.rotateY(variant * 0.7 + k);
      cone.translate(0, height * 0.22 + f * height * 0.5 + h / 2, 0);
      wobble(cone, 0.12 + 0.05 * k, variant * 13 + k);
      const c = greens[(variant + k) % greens.length];
      parts.push(paint(cone, c, greens[(variant + k + 1) % greens.length], 0.25, variant + k));
      if (snow) {
        const cap = new ConeGeometry(r * 0.55, h * 0.36, 6, 1);
        cap.translate(0, height * 0.22 + f * height * 0.5 + h * 0.84, 0);
        parts.push(paint(cap, this.pal.snow[4]));
      }
    }
    return merge(parts);
  }

  /** Broadleaf tree made of stacked octahedra (medium tier). */
  roundTree(variant: number): BufferGeometry {
    const parts: BufferGeometry[] = [this.trunk(2.6, 0.26)];
    const rng = new Rng(300 + variant);
    const greens = [this.pal.grass[1], this.pal.foliage[2], this.pal.foliage[3]];
    for (let i = 0; i < 3; i++) {
      const o = new OctahedronGeometry(1.3 - i * 0.25, 0);
      o.scale(1, 1.2, 1);
      o.rotateY(rng.next() * 3);
      o.translate(rng.range(-0.3, 0.3), 3 + i * 1.3, rng.range(-0.3, 0.3));
      wobble(o, 0.15, variant * 7 + i);
      parts.push(paint(o, greens[(i + variant) % 3], greens[(i + variant + 1) % 3], 0.3, i));
    }
    return merge(parts);
  }

  /** Very cheap far-away tree: one cone. */
  farTree(): BufferGeometry {
    const c = new ConeGeometry(2.2, 8, 5, 1);
    c.translate(0, 4.5, 0);
    return merge([paint(c, this.pal.foliage[1])]);
  }

  /** Broken trunk section for debris: vertical, centred on the origin, 2.4 m long. */
  log(): BufferGeometry {
    const t = new CylinderGeometry(0.24, 0.28, 2.4, 6);
    const end = new CylinderGeometry(0.235, 0.235, 0.04, 6);
    end.translate(0, 1.2, 0);
    return merge([
      paint(t, this.pal.wood[1], this.pal.wood[2], 0.3, 7),
      paint(end, this.pal.earth[4]),
    ]);
  }

  stump(): BufferGeometry {
    const t = new CylinderGeometry(0.32, 0.4, 0.55, 6);
    t.translate(0, 0.27, 0);
    const top = new CylinderGeometry(0.3, 0.3, 0.04, 6);
    top.translate(0, 0.56, 0);
    return merge([paint(t, this.pal.wood[1]), paint(top, this.pal.earth[4])]);
  }

  bush(variant: number): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const rng = new Rng(500 + variant);
    for (let i = 0; i < 2 + variant; i++) {
      const o = new OctahedronGeometry(0.6 + rng.next() * 0.35, 0);
      o.scale(1, 0.7, 1);
      o.translate(rng.range(-0.5, 0.5), 0.35, rng.range(-0.5, 0.5));
      parts.push(paint(o, this.pal.grass[1], this.pal.foliage[1], 0.4, i + variant));
    }
    return merge(parts);
  }

  /** Faceted rock; base slightly below the origin. */
  rock(variant: number): BufferGeometry {
    const g = new DodecahedronGeometry(1, 0);
    wobble(g, 0.22, 900 + variant);
    g.scale(1.2, 0.7 + (variant % 3) * 0.12, 1);
    g.translate(0, 0.32, 0);
    const tones = [this.pal.rockLight[2], this.pal.rockDark[2], this.pal.scree[2]];
    return merge([paint(g, tones[variant % 3], tones[(variant + 1) % 3], 0.3, variant)]);
  }

  /** Flat, layered slab (crest outcrops): two stacked tilted plates. */
  rockSlab(): BufferGeometry {
    const a = new DodecahedronGeometry(1, 0);
    wobble(a, 0.18, 931);
    a.scale(1.5, 0.45, 1.1);
    a.rotateZ(0.18);
    a.translate(0, 0.25, 0);
    const b = new DodecahedronGeometry(0.75, 0);
    wobble(b, 0.15, 932);
    b.scale(1.3, 0.5, 1);
    b.rotateZ(-0.12);
    b.translate(0.35, 0.68, 0.1);
    return merge([
      paint(a, this.pal.rockDark[2], this.pal.rockDark[1], 0.35, 3),
      paint(b, this.pal.rockLight[1], this.pal.rockLight[2], 0.35, 4),
    ]);
  }

  /** Stylised crag: a leaning, faceted spire (steep faces). */
  rockSpire(): BufferGeometry {
    const g = new ConeGeometry(0.9, 2.6, 5, 2);
    wobble(g, 0.16, 941);
    g.rotateZ(0.12);
    g.translate(0, 1.15, 0);
    const foot = new DodecahedronGeometry(0.8, 0);
    wobble(foot, 0.2, 942);
    foot.scale(1.3, 0.55, 1.1);
    foot.translate(0.2, 0.2, 0);
    return merge([
      paint(g, this.pal.rockLight[2], this.pal.rockDark[3], 0.4, 5),
      paint(foot, this.pal.rockDark[2], undefined, 0, 6),
    ]);
  }

  /** Rounded stream boulder (water-worn: more facets, lighter top). */
  rockRound(): BufferGeometry {
    const g = new IcosahedronGeometry(1, 1);
    wobble(g, 0.1, 951);
    g.scale(1.15, 0.62, 0.95);
    g.translate(0, 0.3, 0);
    return merge([paint(g, this.pal.scree[2], this.pal.rockLight[1], 0.4, 7)]);
  }

  /** Wooden post with a painted red-white waymark band. */
  waymark(): BufferGeometry {
    const post = new BoxGeometry(0.14, 1.3, 0.14);
    post.translate(0, 0.65, 0);
    const white = new BoxGeometry(0.15, 0.12, 0.15);
    white.translate(0, 1.08, 0);
    const red1 = new BoxGeometry(0.15, 0.1, 0.15);
    red1.translate(0, 1.19, 0);
    const red2 = new BoxGeometry(0.15, 0.1, 0.15);
    red2.translate(0, 0.97, 0);
    return merge([
      paint(post, this.pal.wood[2]),
      paint(white, this.pal.paint[1]),
      paint(red1, this.pal.paint[0]),
      paint(red2, this.pal.paint[0]),
    ]);
  }

  /** Cairn: stacked flat stones with a painted top stone. */
  cairn(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const r = 0.55 - i * 0.1;
      const s = new DodecahedronGeometry(r, 0);
      s.scale(1, 0.5, 1);
      s.translate(i % 2 ? 0.05 : -0.05, y + r * 0.45, 0);
      y += r * 0.85;
      parts.push(
        paint(
          s,
          i === 3 ? this.pal.paint[0] : i % 2 ? this.pal.rockDark[3] : this.pal.rockLight[1],
        ),
      );
    }
    return merge(parts);
  }

  /** Signpost: pole and a board shaped like an arrow pointing along +Z. */
  sign(): BufferGeometry {
    const pole = new BoxGeometry(0.12, 2.2, 0.12);
    pole.translate(0, 1.1, 0);
    const board = new BoxGeometry(0.06, 0.4, 1.1);
    board.translate(0, 1.95, 0.35);
    const tip = new ConeGeometry(0.28, 0.4, 4);
    tip.rotateX(Math.PI / 2);
    tip.rotateZ(Math.PI / 4);
    tip.scale(0.25, 1, 1);
    tip.translate(0, 1.95, 1.08);
    const stripe = new BoxGeometry(0.07, 0.12, 0.9);
    stripe.translate(0, 1.95, 0.32);
    return merge([
      paint(pole, this.pal.wood[1]),
      paint(board, this.pal.paint[1]),
      paint(tip, this.pal.paint[1]),
      paint(stripe, this.pal.paint[0]),
    ]);
  }

  /** Post-and-rail wooden fence segment, 4 m long along +X. */
  fence(): BufferGeometry {
    const post = new BoxGeometry(0.16, 1.1, 0.16);
    post.translate(0, 0.55, 0);
    const rails = [0.45, 0.9].map((y) => {
      const r = new BoxGeometry(4, 0.1, 0.08);
      r.translate(2, y, 0);
      return paint(r, this.pal.wood[2]);
    });
    return merge([paint(post, this.pal.wood[1]), ...rails]);
  }

  /** Bridge plank (1 × 1 m footprint, scaled per instance). */
  plank(): BufferGeometry {
    return merge([paint(new BoxGeometry(1, 0.25, 1), this.pal.wood[2], this.pal.wood[1], 0.5)]);
  }

  beam(): BufferGeometry {
    return merge([paint(new BoxGeometry(1, 1, 1), this.pal.wood[1])]);
  }

  /** Small mountain house: stone base, wooden walls, pyramid roof. */
  house(variant: number): BufferGeometry {
    const w = 6 + variant;
    const d = 5 + (variant % 2);
    const base = new BoxGeometry(w, 1, d);
    base.translate(0, 0.5, 0);
    const walls = new BoxGeometry(w * 0.96, 2.6, d * 0.96);
    walls.translate(0, 2.3, 0);
    const roof = new ConeGeometry(Math.hypot(w, d) * 0.62, 2.4, 4);
    roof.rotateY(Math.PI / 4);
    roof.scale((w / Math.hypot(w, d)) * 1.42, 1, (d / Math.hypot(w, d)) * 1.42);
    roof.translate(0, 4.8, 0);
    const door = new BoxGeometry(1, 1.8, 0.1);
    door.translate(0, 1.9, d * 0.49);
    return merge([
      paint(base, this.pal.rockDark[2]),
      paint(walls, this.pal.wood[2]),
      paint(roof, this.pal.wood[1], this.pal.earth[2], 0.3),
      paint(door, this.pal.wood[1]),
    ]);
  }
}
