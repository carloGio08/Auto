import type { GameContext } from '../../core/context';
import { h } from '../dom';
import { button } from '../components';
import type { Screen } from '../uiManager';

export function createPause(
  ctx: GameContext,
  actions: { resume(): void; restart(): void; settings(): void; quit(): void },
): Screen {
  const t = ctx.i18n.t;
  const resume = button(t('pause.resume'), actions.resume, { icon: 'play', cls: 'primary big' });
  const el = h(
    'div',
    { class: 'screen overlay-screen pause' },
    h(
      'div',
      { class: 'panel narrow' },
      h('h2', {}, t('pause.title')),
      h(
        'nav',
        { class: 'menu-list' },
        resume,
        button(t('pause.restart'), actions.restart, { icon: 'reset' }),
        button(t('pause.settings'), actions.settings, { icon: 'settings' }),
        button(t('pause.quit'), actions.quit, { icon: 'back' }),
      ),
    ),
  );
  return { el, onBack: actions.resume, initialFocus: () => resume };
}
