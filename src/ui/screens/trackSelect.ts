import type { GameContext } from '../../core/context';
import type { ModeId, TimeOfDayId, TrackDef, WeatherId } from '../../data/types';
import { isTrackUnlocked } from '../../game/progression';
import type { I18nKey } from '../../i18n/en';
import { formatTime } from '../../math/util';
import { h } from '../dom';
import { button, header, medalBadge, stepper } from '../components';
import { icon } from '../icons';
import type { Screen } from '../uiManager';

export interface TrackChoice {
  trackId: string;
  mode: ModeId;
  time: TimeOfDayId | 'default';
  weather: WeatherId | 'default';
}

/** Track list + mode, time of day and weather pickers. */
export function createTrackSelect(
  ctx: GameContext,
  onBack: () => void,
  onStart: (c: TrackChoice) => void,
): Screen {
  const t = ctx.i18n.t;
  const tk = ctx.i18n.tk;
  const save = ctx.save.data;
  const tracks = ctx.registries.tracks.all();
  let selected =
    tracks.find((tr) => tr.id === save.lastTrack && isTrackUnlocked(ctx, tr.id)) ?? tracks[0];
  const choice: TrackChoice = {
    trackId: selected.id,
    mode: 'timeAttack',
    time: save.lastTime,
    weather: save.lastWeather,
  };

  const details = h('div', { class: 'track-details' });
  const cards = tracks.map((tr) => {
    const unlocked = isTrackUnlocked(ctx, tr.id);
    const rec = save.records[`${tr.id}:timeAttack`];
    const card = h(
      'button',
      { class: `track-card ${unlocked ? '' : 'locked'}`, type: 'button', 'aria-pressed': 'false' },
      h('span', { class: 'track-name' }, tk(tr.nameKey)),
      h('span', { class: 'track-diff' }, '◆'.repeat(tr.difficulty) + '◇'.repeat(3 - tr.difficulty)),
      h(
        'span',
        { class: 'track-best' },
        unlocked
          ? rec?.bestTime !== null && rec?.bestTime !== undefined
            ? formatTime(rec.bestTime)
            : '—'
          : '',
      ),
      unlocked
        ? medalBadge(rec?.medal ?? 'none', '')
        : h('span', { class: 'ico', html: icon('lock') }),
    );
    card.addEventListener('click', () => {
      if (!unlocked) {
        const prev = ctx.registries.tracks.get(tr.unlockAfter!);
        ctx.ui.toast(t('tracks.locked', { track: tk(prev.nameKey) }), 'bad');
        ctx.audio.sfx?.uiError();
        return;
      }
      select(tr);
    });
    card.dataset.track = tr.id;
    return card;
  });

  const select = (tr: TrackDef): void => {
    selected = tr;
    choice.trackId = tr.id;
    cards.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.track === tr.id)));
    const m = tr.medals;
    details.replaceChildren(
      h('h3', {}, tk(tr.nameKey)),
      h('p', { class: 'muted' }, tk(tr.descriptionKey)),
      h(
        'div',
        { class: 'medal-times' },
        h('span', {}, medalBadge('gold', ''), formatTime(m.gold)),
        h('span', {}, medalBadge('silver', ''), formatTime(m.silver)),
        h('span', {}, medalBadge('bronze', ''), formatTime(m.bronze)),
      ),
      stepper(
        t('tracks.mode'),
        (['timeAttack', 'freeRide'] as ModeId[]).map((id) => ({
          value: id,
          label: t(`mode.${id}.name` as I18nKey),
        })),
        choice.mode,
        (v) => (choice.mode = v),
      ),
      stepper(
        t('tracks.time'),
        [
          {
            value: 'default' as const,
            label: `${t('time.default')} (${t(`time.${tr.defaultTime}` as I18nKey)})`,
          },
          ...(['dawn', 'day', 'sunset', 'night'] as TimeOfDayId[]).map((id) => ({
            value: id,
            label: t(`time.${id}` as I18nKey),
          })),
        ],
        choice.time,
        (v) => (choice.time = v),
      ),
      stepper(
        t('tracks.weather'),
        [
          {
            value: 'default' as const,
            label: `${t('weather.default')} (${t(`weather.${tr.defaultWeather}` as I18nKey)})`,
          },
          ...(['clear', 'fog', 'snow'] as WeatherId[]).map((id) => ({
            value: id,
            label: t(`weather.${id}` as I18nKey),
          })),
        ],
        choice.weather,
        (v) => (choice.weather = v),
      ),
      startBtn,
    );
  };
  const startBtn = button(t('tracks.start'), () => onStart({ ...choice }), {
    icon: 'play',
    cls: 'primary big',
  });
  select(selected);

  const el = h(
    'div',
    { class: 'screen panel-screen track-select' },
    h(
      'div',
      { class: 'panel wide two-col' },
      header(t('tracks.title'), onBack),
      h(
        'div',
        { class: 'cols' },
        h('div', { class: 'track-list scroll' }, ...cards),
        h('div', { class: 'scroll' }, details),
      ),
    ),
  );
  return { el, onBack, initialFocus: () => startBtn };
}
