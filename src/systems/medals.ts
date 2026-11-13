import type { MedalId } from '../core/save';
import { BaseSystem } from './system';

export function medalFor(
  time: number,
  medals: { gold: number; silver: number; bronze: number },
): MedalId {
  if (time <= medals.gold) return 'gold';
  if (time <= medals.silver) return 'silver';
  if (time <= medals.bronze) return 'bronze';
  return 'none';
}

/** Awards bronze/silver/gold from the finish time. */
export class MedalsSystem extends BaseSystem {
  readonly id = 'medals' as const;

  protected setup(): void {
    this.onEvent('run:finish', ({ time }) => {
      const medal = medalFor(time, this.session.cfg.track.medals);
      this.session.medal = medal;
      this.session.events.emit('medal:awarded', { medal });
    });
  }
}
