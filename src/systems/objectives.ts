import { objectiveValue } from '../data/objectives';
import { BaseSystem } from './system';

/**
 * Tracks the mountain's objectives (daily challenge) from the run's statistics, announces each
 * one as it is completed and keeps `session.objectives` up to date for the HUD, medals and
 * results.
 */
export class ObjectivesSystem extends BaseSystem {
  readonly id = 'objectives' as const;
  private acc = 0;

  protected setup(): void {
    const defs = this.session.cfg.mountain.objectives ?? [];
    this.session.objectives = defs.map((def) => ({ def, value: 0, done: false }));
    this.onEvent('run:finish', () => this.refresh());
    this.session.events.emit('objectives:update', { objectives: this.session.objectives });
  }

  private refresh(): void {
    let changed = false;
    for (const o of this.session.objectives) {
      const v = objectiveValue(o.def.kind, this.session);
      if (v !== o.value) {
        o.value = v;
        changed = true;
      }
      if (!o.done && v >= o.def.target) {
        o.done = true;
        changed = true;
        this.session.events.emit('objective:completed', { objective: o });
      }
    }
    if (changed)
      this.session.events.emit('objectives:update', { objectives: this.session.objectives });
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this.refresh();
  }

  summary(): { label: string; value: string }[] {
    const i18n = this.session.ctx.i18n;
    return this.session.objectives.map((o) => ({
      label: i18n.t('results.objective', { name: i18n.tk(`objective.${o.def.kind}`) }),
      value: `${o.done ? '✓' : '✗'} ${fmt(o.value, o.def.kind)} / ${fmt(o.def.target, o.def.kind)}`,
    }));
  }
}

/** Display format of an objective value. */
export function fmt(v: number, kind: string): string {
  if (kind === 'drift') return `${v.toFixed(1)} s`;
  if (kind === 'jump') return `${Math.round(v)} m`;
  return String(Math.floor(v));
}
