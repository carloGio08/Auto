import type { QualityPresetId } from '../config';

/**
 * Visual benchmark route: `?shot=benchmark[&quality=high|medium|low]`. Skips the menu, starts
 * a run on the first mountain at a fixed time of day and weather, parks the jeep at a fixed
 * point of the main trail (physics frozen) with the default chase camera, so the same view
 * renders identically every time (see scripts/benchmark-screenshots.mjs).
 */
export interface Benchmark {
  active: boolean;
  quality: QualityPresetId | null;
}

function parse(): Benchmark {
  if (typeof location === 'undefined') return { active: false, quality: null };
  const q = new URLSearchParams(location.search);
  const quality = q.get('quality');
  return {
    active: q.get('shot') === 'benchmark',
    quality: quality === 'high' || quality === 'medium' || quality === 'low' ? quality : null,
  };
}

export const benchmark: Benchmark = parse();
