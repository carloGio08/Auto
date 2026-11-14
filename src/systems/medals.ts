import type { MedalId } from '../core/save';
import { BaseSystem } from './system';

/** Medal from the style score of a descent (higher is better). */
export function medalFor(
  score: number,
  medals: { gold: number; silver: number; bronze: number },
): MedalId {
  if (score >= medals.gold) return 'gold';
  if (score >= medals.silver) return 'silver';
  if (score >= medals.bronze) return 'bronze';
  return 'none';
}

/** Medal from the number of objectives completed: 1 bronze, 2 silver, all gold. */
export function medalForObjectives(done: number, total: number): MedalId {
  if (total <= 0 || done <= 0) return 'none';
  if (done >= total) return 'gold';
  return done >= 2 ? 'silver' : 'bronze';
}

/**
 * Awards bronze/silver/gold when the base is reached: from the style score, or from the
 * objectives completed when the mode says so (daily challenge).
 */
export class MedalsSystem extends BaseSystem {
  readonly id = 'medals' as const;

  protected setup(): void {
    this.onEvent('run:finish', ({ score }) => {
      const s = this.session;
      const medal =
        s.cfg.mode.medalsBy === 'objectives'
          ? medalForObjectives(s.objectives.filter((o) => o.done).length, s.objectives.length)
          : medalFor(score, s.cfg.mountain.medals);
      this.session.medal = medal;
      this.session.events.emit('medal:awarded', { medal });
    });
  }
}
