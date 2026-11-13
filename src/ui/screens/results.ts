import type { GameContext } from '../../core/context';
import type { RunSummary } from '../../game/session';
import type { I18nKey } from '../../i18n/en';
import { formatTime } from '../../math/util';
import { h } from '../dom';
import { button, medalBadge } from '../components';
import { icon } from '../icons';
import type { Screen } from '../uiManager';

export function createResults(
  ctx: GameContext,
  summary: RunSummary,
  mode: { timed: boolean; recordsEnabled: boolean },
  actions: { retry(): void; next: (() => void) | null; menu(): void },
): Screen {
  const t = ctx.i18n.t;
  const title = summary.finished
    ? mode.timed
      ? t('results.finished')
      : t('results.freeRide')
    : t('results.timeout');
  const retry = button(t('results.retry'), actions.retry, { icon: 'reset', cls: 'primary' });
  const row = (label: string, value: string | HTMLElement, cls = ''): HTMLElement =>
    h(
      'div',
      { class: `result-row ${cls}` },
      h('span', {}, label),
      typeof value === 'string' ? h('b', {}, value) : value,
    );
  const el = h(
    'div',
    { class: 'screen overlay-screen results' },
    h(
      'div',
      { class: 'panel results-panel' },
      h('h2', {}, title),
      summary.finished ? h('div', { class: 'result-time' }, formatTime(summary.time)) : null,
      summary.newRecord
        ? h('div', { class: 'new-record' }, t('results.newRecord'))
        : summary.previousBest !== null && mode.recordsEnabled
          ? h(
              'div',
              { class: 'muted' },
              t('results.best', { time: formatTime(summary.previousBest) }),
            )
          : null,
      mode.timed && summary.finished
        ? h(
            'div',
            { class: `result-medal medal-${summary.medal}` },
            medalBadge(summary.medal, ''),
            t(`medal.${summary.medal}` as I18nKey),
          )
        : null,
      h(
        'div',
        { class: 'result-rows' },
        row(t('results.score'), String(summary.score)),
        row(
          t('results.coins'),
          h('b', {}, h('span', { class: 'ico', html: icon('coin') }), `+${summary.coinsEarned}`),
          'coins',
        ),
        row(t('results.topSpeed'), `${Math.round(summary.topSpeed * 3.6)} km/h`),
        row(t('results.airTime'), `${summary.bestAir.toFixed(2)} s`),
        ...summary.extra.map((e) => row(ctx.i18n.tk(e.label), e.value)),
      ),
      h(
        'nav',
        { class: 'results-actions' },
        retry,
        actions.next ? button(t('results.next'), actions.next, { icon: 'play' }) : null,
        button(t('results.menu'), actions.menu, { icon: 'back' }),
      ),
    ),
  );
  return { el, initialFocus: () => retry, onBack: actions.menu };
}
