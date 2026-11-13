import type { GameContext } from '../core/context';
import type { RunSession } from '../game/session';
import { formatTime } from '../math/util';
import { h, setText } from './dom';
import { icon } from './icons';

/**
 * In-race DOM HUD: time, speed, nitro, combo, altitude/progress bar, trick popups and
 * on-screen touch controls. Only cheap property writes happen per frame.
 */
export class Hud {
  readonly el: HTMLElement;
  private readonly time: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly split: HTMLElement;
  private readonly cp: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly nitroFill: HTMLElement;
  private readonly nitroWrap: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboMult: HTMLElement;
  private readonly comboPts: HTMLElement;
  private readonly comboTimer: HTMLElement;
  private readonly score: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly crystals: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly center: HTMLElement;
  private readonly tricks: HTMLElement;
  private readonly hint: HTMLElement;
  readonly touch: HTMLElement | null;
  private readonly offs: (() => void)[] = [];
  private centerTimer = 0;
  private nitro = 0;
  private nitroActive = false;
  private comboShown = 0;
  private hintTimer = 7;

  constructor(
    private readonly ctx: GameContext,
    private readonly session: RunSession,
    onPause: () => void,
  ) {
    const t = ctx.i18n.t;
    const timed = session.cfg.mode.timed;
    this.time = h('div', { class: 'hud-time' }, '0:00.00');
    this.timeLabel = h('div', { class: 'hud-label' }, timed ? t('hud.time') : t('hud.freeRide'));
    this.split = h('div', { class: 'hud-split' });
    this.cp = h('div', { class: 'hud-cp' });
    this.speed = h('div', { class: 'hud-speed-value' }, '0');
    this.nitroFill = h('div', { class: 'hud-nitro-fill' });
    this.nitroWrap = h(
      'div',
      { class: 'hud-nitro' },
      h('span', { class: 'hud-nitro-icon', html: icon('nitro') }),
      h('div', { class: 'hud-nitro-bar' }, this.nitroFill),
    );
    this.comboMult = h('div', { class: 'combo-mult' });
    this.comboPts = h('div', { class: 'combo-pts' });
    this.comboTimer = h('div', { class: 'combo-timer' });
    this.combo = h('div', { class: 'hud-combo' }, this.comboMult, this.comboPts, this.comboTimer);
    this.score = h('div', { class: 'hud-score' }, '0');
    this.coins = h('span', {}, '0');
    this.crystals = h('span', {}, '0');
    this.marker = h('div', { class: 'alt-marker', html: icon('car') });
    const bar = h(
      'div',
      { class: 'alt-bar' },
      h('div', { class: 'alt-top' }),
      h('div', { class: 'alt-track' }),
      h('div', { class: 'alt-lake' }),
      this.marker,
    );
    const L = session.course.finishS - session.course.startS;
    for (const s of session.course.checkpoints) {
      const f = (s - session.course.startS) / L;
      bar.append(h('div', { class: 'alt-cp', style: `top:${(f * 100).toFixed(1)}%` }));
    }
    this.center = h('div', { class: 'hud-center' });
    this.tricks = h('div', { class: 'hud-tricks' });
    const pauseBtn = h('button', {
      class: 'hud-btn hud-pause silent',
      'aria-label': t('pause.title'),
      html: icon('pause'),
      onclick: () => onPause(),
    });
    const touchMode = ctx.device.touch;
    this.hint = h(
      'div',
      { class: 'hud-hint' },
      touchMode ? t('hud.tutorial.touch') : t('hud.tutorial.keys'),
    );
    if (ctx.save.data.seenTutorial) this.hintTimer = 0;
    this.el = h(
      'div',
      { class: `hud ${touchMode ? 'is-touch' : ''}` },
      h('div', { class: 'hud-tl' }, this.timeLabel, this.time, this.split, this.cp),
      h('div', { class: 'hud-tc' }, this.combo, this.tricks),
      h(
        'div',
        { class: 'hud-tr' },
        h(
          'div',
          { class: 'hud-score-wrap' },
          h('div', { class: 'hud-label' }, t('results.score')),
          this.score,
        ),
        h(
          'div',
          { class: 'hud-pickups' },
          h('span', { class: 'ico', html: icon('coin') }),
          this.coins,
          h('span', { class: 'ico', html: icon('crystal') }),
          this.crystals,
        ),
        pauseBtn,
      ),
      bar,
      h(
        'div',
        { class: 'hud-speed' },
        this.speed,
        h('div', { class: 'hud-unit' }, t('hud.kmh')),
        this.nitroWrap,
      ),
      this.center,
      this.hint,
    );
    this.touch = touchMode ? this.buildTouch(ctx) : null;
    if (this.touch) this.el.append(this.touch);
    this.listen();
  }

  private buildTouch(ctx: GameContext): HTMLElement {
    const tilt = ctx.save.data.settings.touchMode === 'tilt';
    const btn = (action: string, cls: string, ico: string, label = ''): HTMLElement =>
      h(
        'div',
        { class: `tbtn ${cls}`, 'data-touch': action, role: 'button', 'aria-label': action },
        h('span', { html: icon(ico) }),
        label ? h('small', {}, label) : null,
      );
    const left = h(
      'div',
      { class: 'touch-left' },
      tilt ? null : btn('steerLeft', 'steer', 'left'),
      tilt ? null : btn('steerRight', 'steer', 'right'),
    );
    const right = h(
      'div',
      { class: 'touch-right' },
      h(
        'div',
        { class: 'touch-col' },
        btn('nitro', 'small nitro', 'nitro'),
        btn('handbrake', 'small', 'drift2'),
      ),
      h(
        'div',
        { class: 'touch-col' },
        ctx.save.data.settings.autoAccelerate ? null : btn('throttle', 'gas', 'gas'),
        btn('brake', 'brake', 'brake'),
      ),
    );
    const top = h(
      'div',
      { class: 'touch-top' },
      btn('reset', 'mini', 'reset'),
      btn('camera', 'mini', 'camera'),
    );
    return h('div', { class: 'touch-controls' }, left, right, top);
  }

  private listen(): void {
    const ev = this.session.events;
    const t = this.ctx.i18n.t;
    this.offs.push(
      ev.on('run:countdown', ({ value }) =>
        this.flashCenter(value > 0 ? String(value) : t('hud.go'), value > 0 ? 'count' : 'go', 0.9),
      ),
      ev.on('checkpoint:passed', ({ index, total, bonus, split }) => {
        this.flashCenter(
          bonus > 0 ? t('hud.checkpoint', { bonus }) : `${index + 1}/${total}`,
          'good',
          1.4,
        );
        setText(this.split, t('hud.split', { time: formatTime(split) }));
      }),
      ev.on('run:finish', () => this.flashCenter(t('hud.finish'), 'gold', 3)),
      ev.on('run:timeout', () => this.flashCenter(t('hud.timeout'), 'bad', 3)),
      ev.on('style:trick', ({ label, points }) => this.popTrick(label, points)),
      ev.on('style:combo', ({ multiplier, pending }) => {
        this.comboShown = multiplier;
        setText(this.comboMult, multiplier > 0 ? `×${multiplier}` : '');
        setText(this.comboPts, pending > 0 ? `${pending}` : '');
        this.combo.classList.toggle('show', multiplier > 0);
        this.combo.classList.remove('bump');
        void this.combo.offsetWidth;
        this.combo.classList.add('bump');
      }),
      ev.on('style:comboBanked', ({ points }) => this.popTrick(`+${points}`, 0, 'banked')),
      ev.on('style:comboLost', () => this.combo.classList.add('lost')),
      ev.on('nitro:changed', ({ amount, active }) => {
        this.nitro = amount;
        this.nitroActive = active;
      }),
      ev.on('ui:toast', ({ text, tone }) => this.ctx.ui.toast(this.ctx.i18n.tk(text), tone)),
      ev.on('achievement:unlocked', ({ id }) => {
        const a = this.ctx.registries.achievements.get(id);
        this.ctx.ui.toast(
          t('toast.achievement', { name: this.ctx.i18n.tk(a.nameKey) }),
          'gold',
          3500,
        );
      }),
    );
  }

  private flashCenter(text: string, tone: string, seconds: number): void {
    this.center.className = `hud-center show tone-${tone}`;
    setText(this.center, text);
    this.centerTimer = seconds;
    void this.center.offsetWidth;
    this.center.classList.add('pop');
  }

  private popTrick(label: string, points: number, cls = ''): void {
    const [key, suffix] = label.split('|');
    const text = key.startsWith('trick.')
      ? `${this.ctx.i18n.tk(key)}${suffix ? ' ' + suffix : ''}`
      : key;
    const el = h(
      'div',
      { class: `trick ${cls}` },
      h('b', {}, text),
      points ? h('span', {}, `+${points}`) : null,
    );
    this.tricks.prepend(el);
    while (this.tricks.children.length > 4) this.tricks.lastElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 1400);
    setTimeout(() => el.remove(), 1900);
  }

  update(dt: number): void {
    const s = this.session;
    const timed = s.cfg.mode.timed;
    const shown = timed ? (s.phase === 'countdown' ? s.timeLeft : s.timeLeft) : s.time;
    setText(this.time, formatTime(shown));
    this.time.classList.toggle('low', timed && s.timeLeft < 10 && s.phase === 'running');
    const cps = s.course.checkpoints.length;
    let passed = 0;
    for (const c of s.course.checkpoints) if (s.progressS >= c) passed++;
    setText(this.cp, cps ? `CP ${passed}/${cps}` : '');
    setText(this.speed, String(Math.round(s.vehicle.physics.speed * 3.6)));
    setText(this.score, String(s.score));
    setText(this.coins, String(s.coins));
    setText(this.crystals, String(s.crystals));
    this.nitroFill.style.transform = `scaleX(${this.nitro.toFixed(3)})`;
    this.nitroWrap.classList.toggle('active', this.nitroActive);
    this.nitroWrap.classList.toggle('full', this.nitro > 0.99);
    this.marker.style.top = `${(s.progress * 100).toFixed(2)}%`;
    if (this.centerTimer > 0) {
      this.centerTimer -= this.ctx.loop.realDt;
      if (this.centerTimer <= 0) this.center.classList.remove('show');
    }
    if (this.comboShown === 0) this.combo.classList.remove('lost');
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      this.hint.classList.toggle('show', this.hintTimer > 0 && s.phase !== 'finished');
      if (this.hintTimer <= 0 && !this.ctx.save.data.seenTutorial) {
        this.ctx.save.data.seenTutorial = true;
        this.ctx.save.save();
      }
    }
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.el.remove();
  }
}
