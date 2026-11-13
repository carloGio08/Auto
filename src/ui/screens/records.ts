import type { GameContext } from '../../core/context';
import { formatTime } from '../../math/util';
import { h } from '../dom';
import { header, medalBadge } from '../components';
import { icon } from '../icons';
import type { Screen } from '../uiManager';
import type { I18nKey } from '../../i18n/en';

/** Best times per track, achievements grid and career stats. */
export function createRecords(ctx: GameContext, onClose: () => void): Screen {
  const t = ctx.i18n.t;
  const tk = ctx.i18n.tk;
  const save = ctx.save.data;
  const tracks = ctx.registries.tracks.all().map((tr) => {
    const rec = save.records[`${tr.id}:timeAttack`];
    return h(
      'div',
      { class: 'record-row' },
      medalBadge(rec?.medal ?? 'none', t(`medal.${rec?.medal ?? 'none'}` as I18nKey)),
      h('span', { class: 'record-name' }, tk(tr.nameKey)),
      h(
        'span',
        { class: 'record-time' },
        rec?.bestTime !== null && rec?.bestTime !== undefined
          ? formatTime(rec.bestTime)
          : t('records.noTime'),
      ),
      h('span', { class: 'record-score' }, rec ? String(rec.bestScore) : ''),
    );
  });
  const achievements = ctx.registries.achievements.all().map((a) => {
    const done = save.achievements.includes(a.id);
    return h(
      'div',
      { class: `ach ${done ? 'done' : ''}` },
      h('span', { class: 'ach-ico', html: icon(done ? a.icon : 'lock') }),
      h(
        'div',
        {},
        h('b', {}, tk(a.nameKey)),
        h('p', {}, tk(a.descriptionKey)),
        h('small', {}, t('records.reward', { coins: a.reward })),
      ),
    );
  });
  const st = save.stats;
  const stat = (key: I18nKey, value: string): HTMLElement =>
    h('div', { class: 'career-stat' }, h('span', {}, t(key)), h('b', {}, value));
  const el = h(
    'div',
    { class: 'screen panel-screen records' },
    h(
      'div',
      { class: 'panel wide' },
      header(t('records.title'), onClose),
      h(
        'div',
        { class: 'scroll records-body' },
        h('h3', {}, t('records.tracks')),
        ...tracks,
        h('h3', {}, t('records.stats')),
        h(
          'div',
          { class: 'career' },
          stat('records.stat.runs', String(st.runsFinished)),
          stat('records.stat.distance', `${(st.totalDistance / 1000).toFixed(1)} km`),
          stat('records.stat.air', `${st.bestAirTime.toFixed(2)} s`),
          stat('records.stat.flips', String(st.totalFlips)),
          stat('records.stat.combo', `×${st.bestCombo}`),
          stat('records.stat.drift', `${st.longestDrift.toFixed(1)} s`),
          stat('records.stat.nearMisses', String(st.nearMisses)),
        ),
        h(
          'h3',
          {},
          `${t('records.achievements')} ${save.achievements.length}/${ctx.registries.achievements.size}`,
        ),
        h('div', { class: 'ach-grid' }, ...achievements),
      ),
    ),
  );
  return { el, onBack: onClose };
}
