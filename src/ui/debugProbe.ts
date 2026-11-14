import { BIOME_IDS } from '../data/biomes';
import { defaultPalette, resolvePalette } from '../data/palette';
import { undergrowth } from '../data/vegetation';
import { Mat, MATERIALS } from '../terrain/biome';
import type { Course } from '../terrain/course';
import { TerrainColorer, toPatchPalette } from '../terrain/splat';
import { ECO_STRIDE, ecologyAt } from '../world/propPlacement';
import type { GroundCover } from '../world/groundCover';
import { RICH } from '../world/richness';

/**
 * Development probe (F6 in dev builds or with ?debug, shown at start with ?probe): what the
 * generator decided at the jeep's position — biome, slope, ecology masks, material (colour
 * ramp) weights, baked AO, ground-cover instances by kind and the richness score of the
 * ~32 m cell with its components. Diagnoses bland zones (docs/bland-zones-diagnosis.md).
 */
export class DebugProbe {
  readonly el: HTMLDivElement;
  visible = false;
  private readonly eco = new Float32Array(ECO_STRIDE);
  private readonly w = new Float32Array(Mat.Count);
  private readonly colorer: TerrainColorer;
  private timer = 0;

  constructor(
    private readonly course: Course,
    private readonly cover: GroundCover,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'debug-probe';
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      top: '90px',
      zIndex: '50',
      font: '11px/1.35 ui-monospace, monospace',
      color: '#e8f0e0',
      background: 'rgba(10, 16, 12, 0.78)',
      padding: '8px 10px',
      borderRadius: '8px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: 'none',
    } as CSSStyleDeclaration);
    document.body.append(this.el);
    this.colorer = new TerrainColorer(
      course.terrain,
      toPatchPalette(resolvePalette(defaultPalette)),
    );
  }

  toggle(on = !this.visible): void {
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
  }

  update(dt: number, x: number, z: number): void {
    if (!this.visible || (this.timer -= dt) > 0) return;
    this.timer = 0.25;
    const c = this.course;
    const t = c.terrain;
    const e = this.eco;
    ecologyAt(c, x, z, e);
    const h = e[1];
    const q = t.lastQuery;
    const roadEdge = q.found ? Math.abs(q.lateral - q.offset) - q.halfWidth : 1e4;
    const ny = 1 / Math.sqrt(1 + e[4] * e[4]);
    const hz = t.height(x, z + 2) - t.height(x, z - 2);
    t.biomes.weights({ x, z, h, ny, nz: -hz / 4 / Math.sqrt(1 + e[4] * e[4]), roadEdge }, this.w);
    const mats = MATERIALS.map((m, i) => [m, this.w[i]] as [string, number])
      .filter(([, v]) => v > 0.02)
      .sort((a, b) => b[1] - a[1])
      .map(([m, v]) => `${m} ${(v * 100).toFixed(0)}%`)
      .join(', ');
    const ao = this.colorer.occlusion(x, z, roadEdge);
    const cell = this.cover.cellAt(x, z);
    const lines = [
      `pos ${x.toFixed(0)}, ${z.toFixed(0)}   alt ${h.toFixed(0)} m   slope ${((Math.atan(e[4]) * 180) / Math.PI).toFixed(0)}°`,
      `biome ${BIOME_IDS[e[10]]}   trees ${e[0].toFixed(2)}   alt01 ${e[2].toFixed(2)}`,
      `wet ${e[3].toFixed(2)}   curv ${e[11].toFixed(2)}   road ${roadEdge > 1e3 ? '-' : roadEdge.toFixed(1)} m`,
      `habitat forest ${e[6].toFixed(2)} flowers ${e[7].toFixed(2)} grass ${e[8].toFixed(2)}`,
      `ramps ${mats}`,
      `AO ${ao.toFixed(2)}   rough ${t.biomes.rough.toFixed(2)}`,
    ];
    if (cell) {
      const r = cell.record;
      lines.push(
        `cell biome ${BIOME_IDS[r[RICH.biome]]}   score ${r[RICH.score].toFixed(2)}` +
          `   filler +${r[RICH.filler]}`,
        `  variety ${r[RICH.variety].toFixed(2)} (${r[RICH.types]} kinds)` +
          `   density ${r[RICH.density].toFixed(2)} (${r[RICH.count]})`,
        `  colour ${r[RICH.colour].toFixed(2)} (std ${r[RICH.colourStd].toFixed(1)})` +
          `   relief ${r[RICH.relief].toFixed(2)} (std ${r[RICH.reliefStd].toFixed(2)} m)`,
        `  props ${cell.kinds
          .map((n, k) => (n ? `${undergrowth[k].kind} ${n}` : ''))
          .filter(Boolean)
          .join(', ')}`,
      );
    } else lines.push('cell: not loaded');
    this.el.textContent = lines.join('\n');
  }

  dispose(): void {
    this.el.remove();
  }
}
