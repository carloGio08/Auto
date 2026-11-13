import type { InputManager } from '../input/inputManager';
import type { AudioEngine } from '../audio/audioEngine';
import { h } from './dom';

/** A UI screen: a DOM subtree plus optional lifecycle hooks. */
export interface Screen {
  readonly el: HTMLElement;
  /** Back/Escape on this screen. Return false to ignore. */
  onBack?(): void;
  update?(dt: number): void;
  dispose?(): void;
  /** Element to focus first (defaults to the first focusable element). */
  initialFocus?(): HTMLElement | null;
}

const FOCUSABLE =
  'button:not([disabled]), [data-nav]:not([disabled]), input:not([disabled]), select:not([disabled])';

/**
 * Owns the overlay above the canvas: a main screen, a stack of modal screens, toasts and
 * spatial focus navigation for keyboard and gamepad.
 */
export class UIManager {
  readonly root: HTMLElement;
  readonly toasts: HTMLElement;
  private main: Screen | null = null;
  private readonly modals: Screen[] = [];
  private repeatTimer = 0;
  private repeatDir: 'uiUp' | 'uiDown' | 'uiLeft' | 'uiRight' | null = null;
  /** When false (e.g. driving), keyboard/gamepad focus navigation is disabled. */
  navEnabled = true;

  constructor(
    private readonly input: InputManager,
    private readonly audio: AudioEngine,
  ) {
    this.root = document.getElementById('ui') ?? document.body.appendChild(h('div', { id: 'ui' }));
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(this.toasts);
    // UI sounds for any button.
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t && !t.classList.contains('silent')) this.audio.sfx?.uiConfirm();
    });
    // Mouse users get no focus ring; keyboard/gamepad users do.
    window.addEventListener('pointerdown', () => document.body.classList.remove('kbd-nav'), true);
  }

  get top(): Screen | null {
    return this.modals[this.modals.length - 1] ?? this.main;
  }

  /** Replaces the main screen (and closes modals). */
  setScreen(screen: Screen | null): void {
    while (this.modals.length) this.closeModal();
    if (this.main) {
      this.main.dispose?.();
      this.main.el.remove();
    }
    this.main = screen;
    if (screen) {
      this.root.append(screen.el);
      this.focusInitial(screen);
    }
  }

  openModal(screen: Screen): void {
    this.modals.push(screen);
    screen.el.classList.add('modal');
    this.root.append(screen.el);
    this.focusInitial(screen);
  }

  closeModal(): void {
    const m = this.modals.pop();
    if (!m) return;
    m.dispose?.();
    m.el.remove();
    const top = this.top;
    if (top) this.focusInitial(top);
  }

  get modalOpen(): boolean {
    return this.modals.length > 0;
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'info', ms = 2200): void {
    const el = h('div', { class: `toast toast-${tone}` }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  private focusInitial(screen: Screen): void {
    if (!document.body.classList.contains('kbd-nav')) return;
    const el = screen.initialFocus?.() ?? screen.el.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus({ preventScroll: false });
  }

  update(dt: number): void {
    this.main?.update?.(dt);
    for (const m of this.modals) m.update?.(dt);
    if (!this.navEnabled) return;
    const top = this.top;
    if (!top) return;
    const input = this.input;
    if (input.pressed('uiBack') && top.onBack) {
      input.consume('uiBack');
      input.consume('pause');
      this.audio.sfx?.uiBack();
      top.onBack();
      return;
    }
    const dirs = ['uiUp', 'uiDown', 'uiLeft', 'uiRight'] as const;
    let dir: (typeof dirs)[number] | null = null;
    for (const d of dirs) if (input.pressed(d)) dir = d;
    // Key repeat for held directions.
    if (!dir && this.repeatDir && input.held(this.repeatDir)) {
      this.repeatTimer -= dt;
      if (this.repeatTimer <= 0) {
        dir = this.repeatDir;
        this.repeatTimer = 0.11;
      }
    } else if (dir) {
      this.repeatDir = dir;
      this.repeatTimer = 0.38;
    }
    if (dir) {
      document.body.classList.add('kbd-nav');
      this.move(top.el, dir);
    }
    if (input.pressed('uiConfirm') && document.body.classList.contains('kbd-nav')) {
      const active = document.activeElement as HTMLElement | null;
      if (active && top.el.contains(active) && active.tagName !== 'INPUT') {
        input.consume('uiConfirm');
        active.click();
      } else if (!active || !top.el.contains(active)) {
        this.focusInitial(top);
      }
    }
  }

  /** Spatial navigation: picks the closest focusable element in the pressed direction. */
  private move(container: HTMLElement, dir: 'uiUp' | 'uiDown' | 'uiLeft' | 'uiRight'): void {
    const active = document.activeElement as HTMLElement | null;
    const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (e) => e.offsetParent !== null,
    );
    if (!items.length) return;
    if (!active || !container.contains(active)) {
      items[0].focus();
      return;
    }
    // Sliders/steppers consume left/right.
    if ((dir === 'uiLeft' || dir === 'uiRight') && active.dataset.adjust !== undefined) {
      active.dispatchEvent(new CustomEvent('nav-adjust', { detail: dir === 'uiLeft' ? -1 : 1 }));
      this.audio.sfx?.uiMove();
      return;
    }
    const a = active.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === active) continue;
      const r = el.getBoundingClientRect();
      const bx = r.left + r.width / 2;
      const by = r.top + r.height / 2;
      const dx = bx - ax;
      const dy = by - ay;
      let primary = 0;
      let secondary = 0;
      if (dir === 'uiUp') {
        primary = -dy;
        secondary = Math.abs(dx);
      } else if (dir === 'uiDown') {
        primary = dy;
        secondary = Math.abs(dx);
      } else if (dir === 'uiLeft') {
        primary = -dx;
        secondary = Math.abs(dy);
      } else {
        primary = dx;
        secondary = Math.abs(dy);
      }
      if (primary <= 2) continue;
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      this.audio.sfx?.uiMove();
    }
  }
}
