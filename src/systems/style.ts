import { treeTiers } from '../data/trees';
import { config } from '../config';
import type { I18nKey } from '../i18n/en';
import { BaseSystem } from './system';

/**
 * Style scoring with combos: every trick adds points to a pending pool and raises the
 * multiplier. Driving clean for `comboWindow` seconds banks pending × multiplier; crashing
 * loses it.
 */
export class StyleSystem extends BaseSystem {
  readonly id = 'style' as const;
  pending = 0;
  multiplier = 0;
  timer = 0;
  tricks = 0;
  bestMultiplier = 0;
  private lastProgress = 0;

  protected setup(): void {
    const g = config.gameplay;
    this.lastProgress = this.session.progressS;
    this.onEvent('vehicle:drift', ({ duration, angle }) => {
      const pts = Math.round(duration * 140 * (0.6 + angle));
      this.trick('trick.drift', pts);
    });
    this.onEvent('vehicle:landed', ({ airTime, perfect, distance }) => {
      if (airTime < g.minAirTime) return;
      const big = airTime > 1.5;
      this.trick(big ? 'trick.bigAir' : 'trick.air', Math.round(airTime * 160 + distance * 4));
      if (perfect) this.trick('trick.perfectLanding', 250);
    });
    this.onEvent('vehicle:flip', ({ kind, count }) => {
      const key: I18nKey =
        kind === 'backflip'
          ? 'trick.backflip'
          : kind === 'frontflip'
            ? 'trick.frontflip'
            : 'trick.barrelRoll';
      this.trick(key, (kind === 'barrelRoll' ? 600 : 500) * count, count > 1 ? `×${count}` : '');
    });
    this.onEvent('vehicle:nearMiss', () => this.trick('trick.nearMiss', 150));
    this.onEvent('treeBroken', ({ tier }) =>
      this.trick(tier === 'young' ? 'trick.timber' : 'trick.bigTimber', treeTiers[tier].score),
    );
    this.onEvent(
      'collectible:picked',
      ({ kind }) => kind === 'crystal' && this.trick('trick.crystal', g.crystalScore),
    );
    this.onEvent('vehicle:crash', () => this.lose());
    this.onEvent('run:reset', () => this.lose());
    this.onEvent('run:finish', () => this.bank());
  }

  private trick(label: I18nKey, points: number, suffix = ''): void {
    if (this.session.phase !== 'running') return;
    this.tricks++;
    this.pending += points;
    this.multiplier = Math.min(config.gameplay.comboMaxMultiplier, this.multiplier + 1);
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    this.timer = config.gameplay.comboWindow;
    this.session.events.emit('style:trick', {
      label: label + (suffix ? `|${suffix}` : ''),
      points,
    });
    this.session.events.emit('style:combo', { multiplier: this.multiplier, pending: this.pending });
  }

  private bank(): void {
    if (this.pending <= 0) return;
    const points = this.pending * Math.max(1, this.multiplier);
    this.session.events.emit('style:comboBanked', { points });
    this.pending = 0;
    this.multiplier = 0;
    this.session.events.emit('style:combo', { multiplier: 0, pending: 0 });
  }

  private lose(): void {
    if (this.pending <= 0) return;
    const lost = this.pending * this.multiplier;
    this.pending = 0;
    this.multiplier = 0;
    this.timer = 0;
    this.session.events.emit('style:comboLost', { lost });
    this.session.events.emit('style:combo', { multiplier: 0, pending: 0 });
    this.session.events.emit('ui:toast', { text: 'toast.crash', tone: 'bad' });
  }

  fixedUpdate(dt: number): void {
    const s = this.session;
    // Shortcut detection: progress jumped forward much faster than driving allows.
    const jump = s.progressS - this.lastProgress;
    if (jump > 70) this.trick('trick.shortcut', Math.round(jump * 3));
    this.lastProgress = s.progressS;
    if (this.pending <= 0) return;
    const tel = s.vehicle.telemetry;
    // The combo timer pauses while a trick is in progress.
    if (!tel.drifting && !tel.airborne) {
      this.timer -= dt;
      if (this.timer <= 0) this.bank();
    }
  }

  onReset(): void {
    this.lastProgress = this.session.progressS;
  }

  summary(): { label: string; value: string }[] {
    return [];
  }
}
