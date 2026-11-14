import type { GameContext } from '../../core/context';
import { todayKey } from '../../data/mountains';
import { h } from '../dom';
import { button, iconButton } from '../components';
import { icon } from '../icons';
import type { Screen } from '../uiManager';

export interface MainMenuActions {
  play(): void;
  garage(): void;
  tracks(): void;
  daily(): void;
  records(): void;
  settings(): void;
  credits(): void;
}

/** Low-poly title logo drawn as inline SVG. */
function logo(title: string): HTMLElement {
  const svg = `<svg viewBox="0 0 320 120" class="logo-svg" aria-hidden="true">
    <defs><linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient></defs>
    <polygon points="20,100 85,22 120,62 150,30 210,100" fill="#2d3a55" opacity=".85"/>
    <polygon points="85,22 100,40 92,44 80,36 70,46" fill="#eef3f8"/>
    <polygon points="150,30 163,44 156,48 146,42 138,50" fill="#eef3f8"/>
    <polygon points="120,100 190,40 300,100" fill="#3d4c6d" opacity=".9"/>
    <polygon points="190,40 205,54 197,58 186,51 176,60" fill="#eef3f8"/>
    <path d="M40 100 C 90 80, 120 96, 150 82 S 230 70, 300 100" stroke="url(#lg1)" stroke-width="5" fill="none" stroke-linecap="round"/>
  </svg>`;
  return h(
    'div',
    { class: 'logo' },
    h('div', { html: svg }),
    h(
      'h1',
      { class: 'logo-title' },
      ...title.split(' ').map((w, i) => h('span', { class: `logo-word w${i}` }, w)),
    ),
  );
}

export function createMainMenu(
  ctx: GameContext,
  actions: MainMenuActions,
  onFullscreen: () => void,
  onMute: () => boolean,
): Screen {
  const t = ctx.i18n.t;
  const coins = h(
    'span',
    { class: 'coin-count' },
    h('span', { class: 'ico', html: icon('coin') }),
    String(ctx.save.data.coins),
  );
  const muteBtn = iconButton(
    ctx.save.data.settings.muted ? 'soundOff' : 'soundOn',
    t('settings.mute'),
    () => {
      const muted = onMute();
      muteBtn.innerHTML = icon(muted ? 'soundOff' : 'soundOn');
    },
  );
  const play = button(t('menu.play'), actions.play, { icon: 'play', cls: 'primary big' });
  const el = h(
    'div',
    { class: 'screen main-menu' },
    h(
      'div',
      { class: 'menu-top' },
      coins,
      h('div', { class: 'spacer' }),
      muteBtn,
      iconButton('fullscreen', t('menu.fullscreen'), onFullscreen),
    ),
    h(
      'div',
      { class: 'menu-body' },
      logo(t('app.title')),
      h('p', { class: 'tagline' }, t('app.tagline')),
      h(
        'nav',
        { class: 'menu-list' },
        play,
        button(t('menu.tracks'), actions.tracks, { icon: 'map' }),
        button(t('menu.garage'), actions.garage, { icon: 'garage' }),
        h(
          'div',
          { class: 'menu-daily' },
          button(t('menu.daily'), actions.daily, { icon: 'calendar', cls: 'accent' }),
          h('small', {}, t('menu.dailySub', { date: todayKey() })),
        ),
        h(
          'div',
          { class: 'menu-row' },
          button(t('menu.records'), actions.records, { icon: 'trophy', cls: 'small' }),
          button(t('menu.settings'), actions.settings, { icon: 'settings', cls: 'small' }),
          button(t('menu.credits'), actions.credits, { icon: 'info', cls: 'small' }),
        ),
      ),
    ),
    h('div', { class: 'menu-version' }, `v${__APP_VERSION__}`),
  );
  return { el, initialFocus: () => play };
}
