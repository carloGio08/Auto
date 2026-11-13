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

/** Awards bronze/silver/gold from the final style score when the base is reached. */
export class MedalsSystem extends BaseSystem {
  readonly id = 'medals' as const;

  protected setup(): void {
    this.onEvent('run:finish', ({ score }) => {
      const medal = medalFor(score, this.session.cfg.track.medals);
      this.session.medal = medal;
      this.session.events.emit('medal:awarded', { medal });
    });
  }
}
