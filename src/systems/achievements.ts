import { checkAchievements } from '../game/progression';
import { BaseSystem } from './system';

/** Updates lifetime stats live during the run and unlocks achievements as they happen. */
export class AchievementsSystem extends BaseSystem {
  readonly id = 'achievements' as const;

  protected setup(): void {
    const save = this.session.ctx.save;
    const stats = save.data.stats;
    const check = (): void => {
      for (const a of checkAchievements(this.session.ctx))
        this.session.events.emit('achievement:unlocked', { id: a.id });
    };
    this.onEvent('vehicle:landed', ({ airTime }) => {
      if (airTime > stats.bestAirTime) {
        stats.bestAirTime = airTime;
        check();
      }
    });
    this.onEvent('vehicle:flip', ({ count }) => {
      stats.totalFlips += count;
      check();
    });
    this.onEvent('vehicle:drift', ({ duration }) => {
      if (duration > stats.longestDrift) {
        stats.longestDrift = duration;
        check();
      }
    });
    this.onEvent('vehicle:nearMiss', () => {
      stats.nearMisses++;
      check();
    });
    this.onEvent('style:combo', ({ multiplier }) => {
      if (multiplier > stats.bestCombo) {
        stats.bestCombo = multiplier;
        check();
      }
    });
    this.onEvent('collectible:picked', ({ kind }) => {
      if (kind === 'crystal') {
        stats.crystals++;
        check();
      }
    });
  }
}
