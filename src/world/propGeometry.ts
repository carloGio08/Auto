import { Color, Vector3, type BufferGeometry } from 'three';
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
import type { UndergrowthKind } from '../data/vegetation';

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

const fn = new Vector3();
const fa = new Vector3();
const fb = new Vector3();
const shadeC = new Color();

/**
 * Two-tone stylised shading in the vertex colours: each face gets a mix of `dark` and `light`
 * from how much it faces the sun (horizontal part) and the sky; undersides go darkest.
 * `lift` brightens (upper tiers catch more light).
 */
function shadeFaces(
  geo: BufferGeometry,
  dark: Color,
  light: Color,
  sun: Vector3,
  lift = 0,
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    fa.set(
      pos.getX(i + 1) - pos.getX(i),
      pos.getY(i + 1) - pos.getY(i),
      pos.getZ(i + 1) - pos.getZ(i),
    );
    fb.set(
      pos.getX(i + 2) - pos.getX(i),
      pos.getY(i + 2) - pos.getY(i),
      pos.getZ(i + 2) - pos.getZ(i),
    );
    fn.crossVectors(fa, fb).normalize();
    let k = 0;
    if (fn.y > -0.3) {
      const side = fn.x * sun.x + fn.z * sun.z;
      k = Math.min(1, Math.max(0, 0.32 + 0.75 * side + 0.2 * fn.y + lift));
    }
    shadeC.copy(dark).lerp(light, k);
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = shadeC.r;
      colors[(i + v) * 3 + 1] = shadeC.g;
      colors[(i + v) * 3 + 2] = shadeC.b;
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

  /**
   * Pine at the reference size of a tier (debris pieces): the stylised pine, scaled to
   * 3.2 / 6.5 / 10.5 m tall and 0.45 × as wide.
   */
  pine(tier: TreeTier, variant: number, snow = false): BufferGeometry {
    const hgt = tier === 'young' ? 3.2 : tier === 'medium' ? 6.5 : 10.5;
    const form = tier === 'young' ? 0 : tier === 'medium' ? 1 : 2;
    const g = this.pineTree(
      form,
      this.pal.foliage[0],
      this.pal.foliage[3],
      new Vector3(0.6, 0.6, 0.5).normalize(),
      snow,
      variant,
    );
    g.scale(hgt * 0.45, hgt, hgt * 0.45);
    g.computeBoundingSphere();
    return g;
  }

  /**
   * Stylised low-poly pine at unit size (1 m tall, crown 1 m wide, origin at the trunk base;
   * instances scale it to the real width and height): a short visible trunk and 4–6 stacked
   * faceted cone tiers, wider and taller at the bottom, each turned and slightly irregular.
   * `form` 0 = young (4 tiers, stocky), 1 = medium (5), 2 = tall (6, slender). Two greens per
   * tree in the vertex colours: faces turned to the sun lighter, undersides and the shaded
   * side darker (instances are not turned around Y, so the baked sun side stays true).
   */
  pineTree(
    form: number,
    dark: Color,
    light: Color,
    sun: Vector3,
    snowy: boolean,
    seed: number,
    spruce = false,
  ): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const rng = new Rng(4100 + seed * 31 + form * 7);
    const n = 4 + form + (spruce ? 1 : 0);
    const trunkVis = form === 0 ? 0.1 : 0.12;
    const t = new CylinderGeometry(0.024, 0.036, trunkVis + 0.22, 5);
    t.translate(0, (trunkVis + 0.22) / 2, 0);
    parts.push(paint(t, this.pal.wood[0], this.pal.wood[1], 0.5, seed));
    const topH = spruce ? 0.24 : 0.28;
    const span = 1 - trunkVis - topH;
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0 : k / (n - 1);
      const y0 = trunkVis + span * f * 0.94;
      const h = Math.min(topH + (1 - f) * (spruce ? 0.16 : 0.2) + rng.range(-0.02, 0.02), 1 - y0);
      const r = 0.5 * (1 - f * (spruce ? 0.8 : 0.74)) * rng.range(0.93, 1.05);
      const cone = new ConeGeometry(r, h, 7, 1);
      cone.rotateY(rng.range(0, Math.PI * 2));
      cone.translate(rng.range(-0.012, 0.012), y0 + h / 2, rng.range(-0.012, 0.012));
      wobble(cone, 0.022, seed * 13 + k + form * 101);
      parts.push(shadeFaces(cone, dark, light, sun, 0.06 * f));
      if (snowy) {
        const ch = h * 0.34;
        const cap = new ConeGeometry(r * 0.48, ch, 7, 1);
        cap.rotateY(rng.range(0, Math.PI * 2));
        cap.translate(0, y0 + h - ch / 2 + 0.005, 0);
        parts.push(paint(cap, this.pal.snow[4], this.pal.snow[2], 0.35, k));
      }
    }
    return merge(parts);
  }

  /** Middle-distance pine: three tiers, same silhouette and two-tone shading. */
  pineLow(dark: Color, light: Color, sun: Vector3): BufferGeometry {
    const parts: BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const f = k / 2;
      const y0 = 0.1 + f * 0.5;
      const h = Math.min(0.3 + (1 - f) * 0.18, 1 - y0);
      const cone = new ConeGeometry(0.5 * (1 - f * 0.72), h, 6, 1);
      cone.rotateY(k * 0.9);
      cone.translate(0, y0 + h / 2, 0);
      parts.push(shadeFaces(cone, dark, light, sun, 0.05 * f));
    }
    return merge(parts);
  }

  /** Canopy mass of a patch of forest (far LOD): unit radius and height, base at 0. */
  canopy(): BufferGeometry {
    const g = new IcosahedronGeometry(1, 0);
    g.scale(1, 0.5, 1);
    g.translate(0, 0.5, 0);
    wobble(g, 0.08, 991);
    // White: the colour comes from the instance (species mix of the patch).
    return merge([paint(g, new Color(1, 1, 1))]);
  }

  /** Undergrowth pieces at unit size. */
  undergrowth(kind: UndergrowthKind): BufferGeometry {
    const rng = new Rng(1200 + kind.length);
    switch (kind) {
      case 'bush':
        return this.bush(0);
      case 'grass': {
        const parts: BufferGeometry[] = [];
        for (let i = 0; i < 4; i++) {
          const blade = new ConeGeometry(0.08, 1, 3, 1);
          blade.rotateZ(rng.range(-0.35, 0.35));
          blade.rotateY((i / 4) * Math.PI * 2);
          blade.translate(rng.range(-0.15, 0.15), 0.45, rng.range(-0.15, 0.15));
          parts.push(paint(blade, i % 2 ? this.pal.grass[1] : this.pal.dryGrass[1]));
        }
        return merge(parts);
      }
      case 'fern': {
        const parts: BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) {
          const leaf = new OctahedronGeometry(0.5, 0);
          leaf.scale(0.22, 0.06, 1);
          leaf.translate(0, 0, 0.45);
          leaf.rotateX(-0.45);
          leaf.rotateY((i / 5) * Math.PI * 2);
          leaf.translate(0, 0.3, 0);
          parts.push(paint(leaf, this.pal.undergrowth[2], this.pal.grass[0], 0.3, i));
        }
        return merge(parts);
      }
      case 'flowerY':
      case 'flowerP': {
        const stem = new CylinderGeometry(0.03, 0.03, 0.8, 3);
        stem.translate(0, 0.4, 0);
        const head = new OctahedronGeometry(0.16, 0);
        head.translate(0, 0.85, 0);
        const c = kind === 'flowerY' ? this.pal.flowers[2] : this.pal.flowers[3];
        return merge([paint(stem, this.pal.grass[1]), paint(head, c)]);
      }
      case 'log': {
        const t = new CylinderGeometry(0.06, 0.07, 1, 6);
        t.rotateZ(Math.PI / 2);
        t.translate(0, 0.06, 0);
        return merge([paint(t, this.pal.wood[1], this.pal.wood[0], 0.4, 3)]);
      }
      case 'stump':
        return this.stump();
    }
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
