import { describe, expect, it } from 'vitest';
import { Course } from '../src/terrain/course';
import { mountains } from '../src/data/mountains';
import { config } from '../src/config';
import { defaultPalette, resolvePalette } from '../src/data/palette';
import { Props } from '../src/world/props';
import { CollisionWorld } from '../src/world/colliders';

const course = new Course(mountains[0]);

describe('vegetation LOD and limits', () => {
  it.each(Object.keys(config.graphics.presets) as (keyof typeof config.graphics.presets)[])(
    '%s: visible trees and canopy masses stay within the preset limits',
    (id) => {
      const preset = config.graphics.presets[id];
      const colliders = new CollisionWorld();
      const props = new Props(course, colliders, preset, resolvePalette(defaultPalette));
      // A forested spot low on the mountain.
      const x = -1300;
      const z = 1500;
      for (let i = 0; i < 12; i++) props.update(x, z, x, z);
      expect(props.visibleTrees).toBeLessThanOrEqual(preset.treeLimit);
      expect(props.visibleTrees).toBeGreaterThan(50);
      // Colliders only near the jeep: none farther than the radius (+ a cell).
      const r = config.world.colliderRadius + config.world.propCellSize * 1.5;
      let near = 0;
      props.forEachTreeNear(x, z, 60, () => near++);
      expect(near).toBeGreaterThan(0);
      let far = 0;
      const cells = (colliders as unknown as { cells: Map<number, { ax: number; az: number }[]> })
        .cells;
      let total = 0;
      for (const list of cells.values())
        for (const c of list) {
          total++;
          if (Math.hypot(c.ax - x, c.az - z) > r) far++;
        }
      expect(total).toBeGreaterThan(0);
      expect(far).toBe(0);
      props.dispose();
    },
    120000,
  );
});
