import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { biomes, BIOME_IDS, richnessRules } from '../src/data/biomes';
import { createDailyMountain, mountains } from '../src/data/mountains';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import type { MountainDef } from '../src/data/types';
import { Rng } from '../src/math/rng';
import { Course } from '../src/terrain/course';
import { toPatchPalette } from '../src/terrain/splat';
import { placeCover } from '../src/world/coverPlacement';
import { cellRelief, RICH, RICH_STRIDE } from '../src/world/richness';

/**
 * World richness sweep (docs/world-richness.md): the richness score of the ~32 m cells of
 * five worlds. By default every third cover tile in both directions plus every tile along
 * every trail (fast enough for CI); RICHNESS_FULL=1 sweeps every cell of every world and
 * RICHNESS_REPORT=1 writes the report with histograms.
 */
const FULL = !!process.env.RICHNESS_FULL;
const REPORT = !!process.env.RICHNESS_REPORT;
const DENSITY = 0.5;
const T = 64;
const palette = toPatchPalette(resolvePalette(defaultPalette));
const worlds: MountainDef[] = [
  ...mountains,
  createDailyMountain('2026-01-01'),
  createDailyMountain('2026-06-15'),
  createDailyMountain('2027-02-28'),
];

interface Sweep {
  id: string;
  cells: number;
  under: number;
  hist: number[];
  byBiome: Record<string, { cells: number; under: number }>;
  roadCells: number;
  roadUnder: number;
  worst: { x: number; z: number; score: number; biome: string }[];
}

function sweep(def: MountainDef): Sweep {
  const course = new Course(def);
  const half = def.halfSize;
  const n = Math.ceil(half / T);
  const tiles = new Set<number>();
  const key = (tx: number, tz: number): number => (tx + 512) * 1024 + tz + 512;
  const step = FULL ? 1 : 3;
  for (let tz = -n; tz < n; tz += step)
    for (let tx = -n; tx < n; tx += step) tiles.add(key(tx, tz));
  // Every tile along every trail.
  const road = course.road;
  const roadTiles = new Set<number>();
  for (let g = 0; g < road.count; g += 4) {
    const k = key(Math.floor(road.x[g] / T), Math.floor(road.z[g] / T));
    tiles.add(k);
    roadTiles.add(k);
  }
  const out: Sweep = {
    id: def.id,
    cells: 0,
    under: 0,
    hist: new Array(10).fill(0),
    byBiome: {},
    roadCells: 0,
    roadUnder: 0,
    worst: [],
  };
  for (const k of tiles) {
    const tx = Math.floor(k / 1024) - 512;
    const tz = (k % 1024) - 512;
    const { cells } = placeCover(course, tx, tz, T, DENSITY, palette);
    const nc = Math.round(Math.sqrt(cells.length / RICH_STRIDE));
    for (let c = 0; c < cells.length / RICH_STRIDE; c++) {
      const o = c * RICH_STRIDE;
      const score = cells[o + RICH.score];
      if (score < 0) continue;
      const id = BIOME_IDS[cells[o + RICH.biome]];
      if (!biomes[id].guaranteed) continue;
      const under = score < richnessRules.threshold;
      out.cells++;
      out.hist[Math.min(9, Math.floor(score * 10))]++;
      const b = (out.byBiome[id] ??= { cells: 0, under: 0 });
      b.cells++;
      if (roadTiles.has(k)) {
        out.roadCells++;
        if (under) out.roadUnder++;
      }
      if (under) {
        out.under++;
        b.under++;
        if (out.worst.length < 8)
          out.worst.push({
            x: tx * T + ((c % nc) + 0.5) * (T / nc),
            z: tz * T + (Math.floor(c / nc) + 0.5) * (T / nc),
            score,
            biome: id,
          });
      }
    }
  }
  return out;
}

const results: Sweep[] = [];

describe('world richness', () => {
  it.each(worlds.map((w) => [w.id, w] as const))(
    '%s: at most 1 % of the meadow and below-tree-line cells under the threshold',
    (_id, def) => {
      const r = sweep(def);
      results.push(r);
      expect(r.cells).toBeGreaterThan(FULL ? 30000 : 3000);
      expect(r.under / r.cells).toBeLessThanOrEqual(0.01);
      expect(r.roadUnder / Math.max(1, r.roadCells)).toBeLessThanOrEqual(0.01);
    },
    FULL ? 1_800_000 : 300_000,
  );

  it('has relief on slopes: no smooth planes over 30 m windows of 15–40° (outside flats)', () => {
    const course = new Course(mountains[0]);
    const rng = new Rng(11);
    let tested = 0;
    let smooth = 0;
    for (let i = 0; i < 4000 && tested < 400; i++) {
      const x = rng.range(-3500, 3500);
      const z = rng.range(-3500, 3500);
      if (course.terrain.waterLevel(x, z) > course.terrain.height(x, z) - 1) continue;
      const q = course.terrain.road;
      void q;
      const r = cellRelief(course, x, z, 30);
      if (r.slope < 0.27 || r.slope > 0.84 || r.flat > 0.5) continue;
      tested++;
      if (r.std < richnessRules.reliefStd) smooth++;
    }
    expect(tested).toBeGreaterThan(150);
    expect(smooth / tested).toBeLessThan(0.02);
  });

  it('writes the report', () => {
    if (!REPORT) return;
    const lines = [
      '# World richness',
      '',
      `Richness score of every ~${richnessRules.cellSize} m cell ${
        FULL ? 'of the whole world' : 'on a 1-in-9 tile lattice and along every trail'
      }, preset density ${DENSITY}, threshold ${richnessRules.threshold}. Counted: meadow biomes and everything below the tree line (scree, rock bands and snowfields excluded). Generated by \`RICHNESS_FULL=1 RICHNESS_REPORT=1 npx vitest run tests/richness.test.ts\`.`,
      '',
      '| World | Cells | Under threshold | Share | Trail cells | Trail under |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...results.map(
        (r) =>
          `| ${r.id} | ${r.cells} | ${r.under} | ${((100 * r.under) / r.cells).toFixed(2)} % | ${r.roadCells} | ${r.roadUnder} |`,
      ),
      '',
    ];
    for (const r of results) {
      const max = Math.max(...r.hist);
      lines.push(`## ${r.id}`, '', '```');
      r.hist.forEach((v, i) => {
        const bar = '█'.repeat(Math.round((40 * v) / Math.max(1, max)));
        lines.push(`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)} ${bar} ${v}`);
      });
      lines.push('```', '');
      lines.push('| Biome | Cells | Under |', '| --- | ---: | ---: |');
      for (const [b, v] of Object.entries(r.byBiome))
        lines.push(`| ${b} | ${v.cells} | ${v.under} |`);
      lines.push('');
      if (r.worst.length)
        lines.push(
          'Lowest cells: ' +
            r.worst
              .map((w) => `(${w.x.toFixed(0)}, ${w.z.toFixed(0)}) ${w.biome} ${w.score.toFixed(2)}`)
              .join('; '),
          '',
        );
    }
    writeFileSync(new URL('../docs/world-richness.md', import.meta.url), lines.join('\n'));
  });
});
