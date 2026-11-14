import type { GameContext } from '../../core/context';
import {
  CAMERA_MODES,
  type LanguageSetting,
  type QualitySetting,
  type TouchMode,
} from '../../core/settings';
import { LANGUAGES } from '../../core/i18n';
import { DEFAULT_KEY_BINDINGS, REBINDABLE, type ActionId } from '../../input/actions';
import { TiltSource } from '../../input/tilt';
import type { I18nKey } from '../../i18n/en';
import { h } from '../dom';
import { button, header, slider, stepper, toggle } from '../components';
import type { Screen } from '../uiManager';

/** Pretty name for a KeyboardEvent.code. */
function keyName(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Arrow', '')
    .replace('Left', ' L')
    .replace('Right', ' R');
}

/** Settings modal: graphics, audio, controls (with key rebinding) and general options. */
export function createSettings(
  ctx: GameContext,
  onClose: () => void,
  onDataReset: () => void,
): Screen {
  const t = ctx.i18n.t;
  const s = ctx.save.data.settings;
  const apply = (): void => {
    ctx.applySettings();
    ctx.save.save();
  };
  const section = (title: I18nKey, ...rows: (HTMLElement | null)[]): HTMLElement =>
    h('section', { class: 'settings-section' }, h('h3', {}, t(title)), ...rows);

  const qualities: QualitySetting[] = ['auto', 'low', 'medium', 'high'];
  const bindingsList = h('div', { class: 'bindings' });
  const renderBindings = (): void => {
    bindingsList.replaceChildren(
      ...REBINDABLE.map((action: ActionId) => {
        const codes = s.bindings[action] ?? DEFAULT_KEY_BINDINGS[action];
        const btn = h(
          'button',
          { class: 'key-btn', type: 'button' },
          codes.map(keyName).join(' / '),
        );
        btn.addEventListener('click', () => {
          btn.textContent = t('settings.pressKey');
          btn.classList.add('listening');
          ctx.keyboard.captureNext = (code) => {
            if (code !== 'Escape') {
              s.bindings[action] = [code];
              apply();
            }
            renderBindings();
          };
        });
        return h('div', { class: 'row' }, h('label', {}, t(`action.${action}` as I18nKey)), btn);
      }),
    );
  };
  renderBindings();

  const tiltRow = slider(
    t('settings.tiltSensitivity'),
    s.tiltSensitivity,
    (v) => ((s.tiltSensitivity = v), apply()),
    0.5,
    2,
    0.1,
  );
  const languages: { value: LanguageSetting; label: string }[] = [
    { value: 'auto', label: t('settings.language.auto') },
    ...Object.entries(LANGUAGES).map(([id, l]) => ({
      value: id as LanguageSetting,
      label: l.name,
    })),
  ];

  const resetBtn = button(
    t('settings.resetData'),
    () => {
      if (resetBtn.dataset.confirm) {
        ctx.save.reset();
        ctx.applySettings();
        ctx.ui.toast(t('settings.resetDone'), 'info');
        onDataReset();
        return;
      }
      resetBtn.dataset.confirm = '1';
      resetBtn.querySelector('.btn-label')!.textContent = t('settings.resetConfirm');
      resetBtn.classList.add('danger');
    },
    { cls: 'small' },
  );

  const body = h(
    'div',
    { class: 'settings-body scroll' },
    section(
      'settings.graphics',
      stepper(
        t('settings.quality'),
        qualities.map((q) => ({ value: q, label: t(`settings.quality.${q}` as I18nKey) })),
        s.quality,
        (v) => ((s.quality = v), apply()),
      ),
      toggle(
        t('settings.showFps'),
        s.showFps,
        (v) => ((s.showFps = v), apply()),
        t('common.on'),
        t('common.off'),
      ),
    ),
    section(
      'settings.audio',
      slider(t('settings.master'), s.masterVolume, (v) => ((s.masterVolume = v), apply())),
      slider(t('settings.music'), s.musicVolume, (v) => ((s.musicVolume = v), apply())),
      slider(t('settings.sfx'), s.sfxVolume, (v) => ((s.sfxVolume = v), apply())),
      toggle(
        t('settings.mute'),
        s.muted,
        (v) => ((s.muted = v), apply()),
        t('common.on'),
        t('common.off'),
      ),
    ),
    section(
      'settings.controls',
      stepper(
        t('settings.touchMode'),
        (['buttons', 'tilt'] as TouchMode[]).map((m) => ({
          value: m,
          label: t(`settings.touch.${m}` as I18nKey),
        })),
        s.touchMode,
        (v) => {
          s.touchMode = v;
          apply();
          if (v === 'tilt') {
            void TiltSource.requestPermission().then((ok) => {
              if (!ok) ctx.ui.toast(t('settings.tiltPermission'), 'bad');
            });
          }
        },
      ),
      tiltRow,
      slider(
        t('settings.steerSensitivity'),
        s.steerSensitivity,
        (v) => ((s.steerSensitivity = v), apply()),
        0.5,
        1.5,
        0.05,
      ),
      toggle(
        t('settings.autoAccelerate'),
        s.autoAccelerate,
        (v) => ((s.autoAccelerate = v), apply()),
        t('common.on'),
        t('common.off'),
      ),
      toggle(
        t('settings.haptics'),
        s.haptics,
        (v) => ((s.haptics = v), apply()),
        t('common.on'),
        t('common.off'),
      ),
      stepper(
        t('settings.camera'),
        CAMERA_MODES.map((c) => ({
          value: c,
          label: t(`settings.camera.${c}` as I18nKey),
        })),
        s.camera,
        (v) => ((s.camera = v), apply()),
      ),
      slider(
        t('settings.cameraDistance'),
        s.cameraDistance,
        (v) => ((s.cameraDistance = v), apply()),
        0.7,
        1.5,
        0.05,
      ),
      slider(
        t('settings.cameraHeight'),
        s.cameraHeight,
        (v) => ((s.cameraHeight = v), apply()),
        0.7,
        1.6,
        0.05,
      ),
      slider(
        t('settings.cameraFov'),
        s.cameraFov,
        (v) => ((s.cameraFov = v), apply()),
        50,
        80,
        1,
        (v) => `${Math.round(v)}°`,
      ),
      slider(
        t('settings.cameraShake'),
        s.cameraShake,
        (v) => ((s.cameraShake = v), apply()),
        0,
        1.5,
        0.05,
      ),
      ctx.device.touch && !ctx.device.mobile ? null : null,
      h('h4', {}, t('settings.bindings')),
      bindingsList,
      button(
        t('settings.resetBindings'),
        () => {
          s.bindings = {};
          apply();
          renderBindings();
        },
        { cls: 'small' },
      ),
    ),
    section(
      'settings.general',
      stepper(t('settings.language'), languages, s.language, (v) => ((s.language = v), apply())),
      resetBtn,
    ),
  );
  const el = h(
    'div',
    { class: 'screen panel-screen settings' },
    h('div', { class: 'panel' }, header(t('settings.title'), onClose), body),
  );
  return {
    el,
    onBack: onClose,
    dispose: () => {
      ctx.keyboard.captureNext = null;
      ctx.save.flush();
    },
  };
}
