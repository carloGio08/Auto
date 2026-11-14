import type { QualityPresetId } from '../config';

/**
 * Visual benchmark route: `?shot=benchmark[&quality=high|medium|low]`. Skips the menu, starts
 * a run on the first mountain at a fixed time of day and weather, parks the jeep at a fixed
 * point of the main trail (physics frozen) with the default chase camera, so the same view
 * renders identically every time (see scripts/benchmark-screenshots.mjs).
 *
 * Also `?shot=richness&spot=N`: the worst-case spots (scripts/richness-screenshots.mjs).
 */
export interface Benchmark {
  active: boolean;
  quality: QualityPresetId | null;
  /**
   * Worst-case richness spot (`?shot=richness&spot=N`, see config.benchmark.spots): the
   * same frozen view, at one of the zones that used to look bland. -1 for the main view.
   */
  spot: number;
}

function parse(): Benchmark {
  if (typeof location === 'undefined') return { active: false, quality: null, spot: -1 };
  const q = new URLSearchParams(location.search);
  const quality = q.get('quality');
  return {
    active: q.get('shot') === 'benchmark' || q.get('shot') === 'richness',
    spot: q.get('shot') === 'richness' ? Number(q.get('spot') ?? 0) : -1,
    quality: quality === 'high' || quality === 'medium' || quality === 'low' ? quality : null,
  };
}

export const benchmark: Benchmark = parse();
