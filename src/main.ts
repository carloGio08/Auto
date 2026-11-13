import './ui/theme.css';
import { config } from './config';
import type { GameContext, StateId } from './core/context';
import { detectDevice } from './core/device';
import { EventBus } from './core/eventBus';
import type { GameEvents } from './core/events';
import { I18n } from './core/i18n';
import { GameLoop } from './core/loop';
import { Renderer } from './core/renderer';
import { SaveManager } from './core/save';
import { StateMachine } from './core/stateMachine';
import { createRegistries } from './data/registry';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { GamepadSource } from './input/gamepad';
import { TiltSource } from './input/tilt';
import { AudioEngine } from './audio/audioEngine';
import { UIManager } from './ui/uiManager';
import { BackdropHost } from './states/backdropHost';
import { BootState } from './states/bootState';
import { MainMenuState } from './states/mainMenuState';
import { GarageState } from './states/garageState';
import { TrackSelectState } from './states/trackSelectState';
import { LoadingState } from './states/loadingState';
import { PlayingState } from './states/playingState';
import { PausedState } from './states/pausedState';
import { ResultsState } from './states/resultsState';
import { FpsMeter } from './ui/fpsMeter';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function start(): void {
  const save = new SaveManager();
  const i18n = new I18n(save.data.settings.language);
  if (!webglAvailable()) {
    document.getElementById('boot-splash')?.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="fatal">${i18n.t('misc.webglError')}</div>`,
    );
    return;
  }
  const device = detectDevice();
  document.body.classList.toggle('touch', device.touch);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new Renderer(canvas, save.data.settings.quality, device);
  const input = new InputManager();
  const keyboard = new KeyboardSource(input);
  input.add(keyboard);
  input.add(new GamepadSource(input));
  const tilt = new TiltSource();
  const audio = new AudioEngine();
  const ui = new UIManager(input, audio);
  const states = new StateMachine<StateId>();
  const events = new EventBus<GameEvents>();
  const fps = new FpsMeter();

  // Context is created before the loop so the loop callbacks can reference it.
  const ctx = {} as GameContext;
  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => states.fixedUpdate(dt),
      update: (dt, alpha) => {
        input.update(loop.realDt);
        ui.update(loop.realDt);
        states.update(dt, alpha);
        renderer.adapt(loop.frameMs, loop.realDt, states.current?.id === 'playing');
        fps.update(loop.realDt, loop.frameMs, renderer);
      },
      render: () => {
        if (ctx.view) renderer.render(ctx.view.scene, ctx.view.camera);
      },
    },
    config.physics.hz,
  );

  Object.assign(ctx, {
    config,
    registries: createRegistries(),
    renderer,
    view: null,
    input,
    keyboard,
    tilt,
    audio,
    save,
    events,
    i18n,
    ui,
    states,
    loop,
    device,
    applySettings(): void {
      const s = save.data.settings;
      if (s.quality !== renderer.setting) renderer.applySetting(s.quality);
      audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.muted, config.features.music);
      input.applySettings(s);
      tilt.sensitivity = s.tiltSensitivity;
      i18n.apply(s.language);
      fps.setVisible(s.showFps || config.features.debugOverlay);
      events.emit('settings:changed', {});
    },
  } satisfies Omit<GameContext, never>);

  // Keep the camera aspect in sync when the window changes.
  const onResize = (): void => {
    renderer.resize();
    const cam = ctx.view?.camera;
    if (cam) {
      cam.aspect = renderer.width / renderer.height;
      cam.updateProjectionMatrix();
    }
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

  // Audio needs a user gesture.
  const unlock = (): void => {
    audio.unlock();
    ctx.applySettings();
    if (states.current?.id === 'mainMenu' || states.current?.id === 'trackSelect')
      audio.music?.play('calm');
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () =>
    document.hidden ? audio.suspend() : audio.resume(),
  );
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      save.data.settings.showFps = !save.data.settings.showFps;
      ctx.applySettings();
    }
  });
  // Block pinch zoom / double-tap zoom / context menu on touch devices.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (device.touch) e.preventDefault();
  });

  ctx.applySettings();

  const backdrop = new BackdropHost(ctx);
  states
    .register('boot', () => new BootState(ctx, backdrop))
    .register('mainMenu', () => new MainMenuState(ctx, backdrop))
    .register('garage', () => new GarageState(ctx))
    .register('trackSelect', () => new TrackSelectState(ctx, backdrop))
    .register('loading', () => new LoadingState(ctx, backdrop))
    .register('playing', () => new PlayingState(ctx))
    .register('paused', () => new PausedState(ctx))
    .register('results', () => new ResultsState(ctx));
  states.onChange = (id) => document.body.setAttribute('data-state', id);
  states.go('boot');
  loop.start();

  if (config.features.serviceWorker && 'serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'activated' && !navigator.serviceWorker.controller)
              ui.toast(i18n.t('misc.offlineReady'), 'info');
          });
        });
      })
      .catch((err) => console.warn('Service worker registration failed', err));
  }
}

start();
