import type { GameContext } from '../../core/context';
import type { I18nKey } from '../../i18n/en';
import { h, setText } from '../dom';
import type { Screen } from '../uiManager';

export interface LoadingScreen extends Screen {
  set(progress: number, stage: I18nKey): void;
}

export function createLoading(ctx: GameContext, trackName: string): LoadingScreen {
  const t = ctx.i18n.t;
  const fill = h('div', { class: 'progress-fill' });
  const stage = h('div', { class: 'loading-stage' }, t('loading.title'));
  const tipIndex = 1 + Math.floor(Math.random() * 8);
  const el = h(
    'div',
    { class: 'screen loading' },
    h(
      'div',
      { class: 'loading-box' },
      h('h2', {}, trackName),
      h('div', { class: 'progress' }, fill),
      stage,
      h('p', { class: 'tip' }, t(`loading.tip.${tipIndex}` as I18nKey)),
    ),
  );
  return {
    el,
    set(progress: number, key: I18nKey) {
      fill.style.transform = `scaleX(${Math.min(1, progress).toFixed(3)})`;
      setText(stage, t(key));
    },
  };
}
