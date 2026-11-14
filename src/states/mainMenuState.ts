import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { createDailyMountain, todayKey } from '../data/mountains';
import { createMainMenu } from '../ui/screens/mainMenu';
import { createSettings } from '../ui/screens/settings';
import { createRecords } from '../ui/screens/records';
import { createCredits } from '../ui/screens/credits';
import type { BackdropHost } from './backdropHost';
import type { LoadingParams } from './loadingState';
import { isMountainUnlocked } from '../game/progression';

export function toggleFullscreen(): void {
  const doc = document as Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => void;
  };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || doc.webkitFullscreenElement) {
    void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    return;
  }
  const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
  Promise.resolve(p)
    .then(() =>
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.(
        'landscape',
      ),
    )
    .catch(() => undefined);
}

/** Main menu over the live 3D backdrop. */
export class MainMenuState implements GameState<StateId> {
  readonly id = 'mainMenu' as const;

  constructor(
    private readonly ctx: GameContext,
    private readonly backdrop: BackdropHost,
  ) {}

  enter(): void {
    const ctx = this.ctx;
    ctx.input.drivingEnabled = false;
    const b = this.backdrop.get();
    b.refreshCar();
    ctx.view = b.view;
    ctx.audio.music?.play('calm');
    this.render();
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.ui.setScreen(
      createMainMenu(
        ctx,
        {
          play: () => {
            const save = ctx.save.data;
            const mountainId =
              isMountainUnlocked(ctx, save.lastMountain) &&
              ctx.registries.mountains.has(save.lastMountain)
                ? save.lastMountain
                : ctx.registries.mountains.all()[0].id;
            const params: LoadingParams = {
              mountainId,
              mode: 'freeDescent',
              time: save.lastTime,
              weather: save.lastWeather,
            };
            ctx.states.go('loading', params);
          },
          garage: () => ctx.states.go('garage'),
          tracks: () => ctx.states.go('trackSelect'),
          daily: () => {
            const mountain = createDailyMountain(todayKey());
            const params: LoadingParams = {
              mountainId: mountain.id,
              mode: 'daily',
              time: 'default',
              weather: 'default',
              mountain,
            };
            ctx.states.go('loading', params);
          },
          records: () => ctx.ui.openModal(createRecords(ctx, () => ctx.ui.closeModal())),
          settings: () =>
            ctx.ui.openModal(
              createSettings(
                ctx,
                () => ctx.ui.closeModal(),
                () => this.render(),
              ),
            ),
          credits: () => ctx.ui.openModal(createCredits(ctx, () => ctx.ui.closeModal())),
        },
        toggleFullscreen,
        () => {
          ctx.save.data.settings.muted = !ctx.save.data.settings.muted;
          ctx.applySettings();
          ctx.save.save();
          return ctx.save.data.settings.muted;
        },
      ),
    );
  }

  update(dt: number): void {
    this.backdrop.get().update(dt);
  }

  exit(): void {
    this.ctx.ui.setScreen(null);
  }
}
