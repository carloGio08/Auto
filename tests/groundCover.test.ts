import { describe, expect, it } from 'vitest';
import { Vector3, type BufferGeometry, type Color } from 'three';
import { config } from '../src/config';
import { mountains } from '../src/data/mountains';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { treeSpecies, undergrowth } from '../src/data/vegetation';
import { Course } from '../src/terrain/course';
import { createRoadPoint, createRoadQuery } from '../src/terrain/road';
import { COVER_STRIDE, placeCover } from '../src/world/coverPlacement';
import { GroundCover } from '../src/world/groundCover';
import { PropGeometry } from '../src/world/propGeometry';
import { placeCell, rockReason, ROCK_STRIDE } from '../src/world/propPlacement';

const course = new Course(mountains[0]);
const road = course.terrain.road;
const palette = resolvePalette(defaultPalette);
const T = config.world.coverTileSize;

/** Tiles along the main trail (every ~400 m). */
const trailTiles: [number, number][] = [];
for (let s = 600; s < road.main.length - 200; s += 400) {
  const p = road.pointAt(s, createRoadPoint());
  trailTiles.push([Math.floor(p.x / T), Math.floor(p.z / T)]);
}
const tiles = trailTiles.map(([tx, tz]) => placeCover(course, tx, tz, T, 1));
const kindOf = (k: number): string => undergrowth[k].kind;

describe('ground cover and boulders', () => {
  it('keeps the trail clear: only pebbles on the band, boulders never on the driving line', () => {
    const q = createRoadQuery();
    let pebblesOnBand = 0;
    for (const d of tiles)
      for (let k = 0; k < d.length; k += COVER_STRIDE) {
        road.query(d[k + 1], d[k + 3], q);
        if (!q.found) continue;
        const edge = Math.abs(q.lateral - q.offset) - q.halfWidth;
        if (kindOf(d[k]) === 'pebble') {
          if (edge < 0) pebblesOnBand++;
        } else expect(edge, kindOf(d[k])).toBeGreaterThan(-0.8);
      }
    expect(pebblesOnBand).toBeGreaterThan(50);
    // Boulder groups: clear of the band by at least their size.
    let boulders = 0;
    for (let s = 600; s < road.main.length - 200; s += 900) {
      const p = road.pointAt(s, createRoadPoint());
      const size = config.world.propCellSize;
      const c = placeCell(course, Math.floor(p.x / size), Math.floor(p.z / size), size, 1);
      for (let i = 0; i < c.rocks.length / ROCK_STRIDE; i++) {
        if (rockReason(c, i) !== 'boulders') continue;
        boulders++;
        const k = i * ROCK_STRIDE;
        road.query(c.rocks[k + 1], c.rocks[k + 3], q);
        if (!q.found) continue;
        const edge = Math.abs(q.lateral - q.offset) - q.halfWidth;
        expect(edge).toBeGreaterThan(c.rocks[k + 4] * 1.0);
      }
    }
    expect(boulders).toBeGreaterThan(5);
  }, 60000);

  it('grows dense grass and flowers in clustered patches of all four colours', () => {
    const counts: Record<string, number> = {};
    const flowers: [number, number][] = [];
    for (const d of tiles)
      for (let k = 0; k < d.length; k += COVER_STRIDE) {
        const n = kindOf(d[k]);
        counts[n] = (counts[n] ?? 0) + 1;
        if (n.startsWith('flower')) flowers.push([d[k + 1], d[k + 3]]);
      }
    expect(counts.grass).toBeGreaterThan(counts.flowerY + counts.flowerR);
    for (const f of ['flowerY', 'flowerR', 'flowerP', 'flowerW'])
      expect(counts[f]).toBeGreaterThan(20);
    // Clustered: most flowers have another flower within 2 m.
    let close = 0;
    const sample = flowers.slice(0, 400);
    for (const [x, z] of sample)
      if (flowers.some(([a, b]) => (a !== x || b !== z) && (a - x) ** 2 + (b - z) ** 2 < 4))
        close++;
    expect(close / sample.length).toBeGreaterThan(0.6);
  });

  it.each(Object.keys(config.graphics.presets) as (keyof typeof config.graphics.presets)[])(
    '%s: stays within the grass, flower and cover caps',
    (id) => {
      const preset = config.graphics.presets[id];
      const gc = new GroundCover(course, preset, palette);
      const p = road.pointAt(9200, createRoadPoint());
      gc.prebuild(p.x, p.z);
      for (let i = 0; i < 6; i++) gc.update(p.x + i * 10, p.z, i);
      expect(gc.counts.grass).toBeLessThanOrEqual(preset.grassLimit);
      expect(gc.counts.flowers).toBeLessThanOrEqual(preset.flowerLimit);
      expect(gc.counts.cover).toBeLessThanOrEqual(preset.coverLimit);
      expect(gc.counts.grass).toBeGreaterThan(200);
      // Weak devices: no wind, grass and flowers at most 60 % of the caps.
      gc.setDegrade(2);
      gc.update(p.x + 100, p.z, 7);
      expect(gc.counts.grass).toBeLessThanOrEqual(Math.floor(preset.grassLimit * 0.6));
      expect(gc.counts.flowers).toBeLessThanOrEqual(Math.floor(preset.flowerLimit * 0.6));
      gc.dispose();
    },
    60000,
  );

  it('colours props only with palette tones (trees: blends of their two species tones)', () => {
    const tones: Color[] = Object.values(palette).flat();
    const isPalette = (r: number, g: number, b: number): boolean =>
      tones.some((c) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < 1e-4);
    const colours = (geo: BufferGeometry): [number, number, number][] => {
      const c = geo.getAttribute('color');
      const out: [number, number, number][] = [];
      for (let i = 0; i < c.count; i++) out.push([c.getX(i), c.getY(i), c.getZ(i)]);
      return out;
    };
    const g = new PropGeometry(palette);
    for (const u of undergrowth)
      for (const [r, gg, b] of colours(g.undergrowth(u.kind)))
        expect(isPalette(r, gg, b), u.kind).toBe(true);
    for (const v of [0, 1])
      for (const [r, gg, b] of colours(g.boulder(v))) expect(isPalette(r, gg, b)).toBe(true);
    // Pines: trunk tones from the palette, crown colours on the segment between the
    // species' shaded and sunlit tones.
    const sun = new Vector3(0.5, 0.7, 0.5).normalize();
    for (const sp of treeSpecies) {
      const dark = palette[sp.foliage.key][sp.foliage.tones[0]];
      const light = palette[sp.foliage.key][sp.foliage.tones[1]];
      const d = [light.r - dark.r, light.g - dark.g, light.b - dark.b];
      const dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      for (const [r, gg, b] of colours(g.pineTree(2, dark, light, sun, false, 1))) {
        if (isPalette(r, gg, b)) continue;
        const t = ((r - dark.r) * d[0] + (gg - dark.g) * d[1] + (b - dark.b) * d[2]) / dd;
        expect(t).toBeGreaterThanOrEqual(-1e-4);
        expect(t).toBeLessThanOrEqual(1 + 1e-4);
        const err =
          Math.abs(dark.r + d[0] * t - r) +
          Math.abs(dark.g + d[1] * t - gg) +
          Math.abs(dark.b + d[2] * t - b);
        expect(err).toBeLessThan(1e-4);
      }
    }
  });
});
