import type { GameContext } from '../../core/context';
import { h } from '../dom';
import { header } from '../components';
import type { Screen } from '../uiManager';

export function createCredits(ctx: GameContext, onClose: () => void): Screen {
  const t = ctx.i18n.t;
  const el = h(
    'div',
    { class: 'screen panel-screen credits' },
    h(
      'div',
      { class: 'panel' },
      header(t('credits.title'), onClose),
      h(
        'div',
        { class: 'scroll credits-body' },
        h('p', {}, t('credits.body')),
        h('h3', {}, t('credits.controls')),
        h('p', {}, t('hud.tutorial.keys')),
        h('p', {}, t('hud.tutorial.touch')),
        h('p', { class: 'muted' }, t('credits.license')),
      ),
    ),
  );
  return { el, onBack: onClose };
}
