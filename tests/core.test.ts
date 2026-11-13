import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/eventBus';
import { StateMachine, type GameState } from '../src/core/stateMachine';
import { GameLoop } from '../src/core/loop';
import { I18n, detectLanguage } from '../src/core/i18n';
import { medalFor } from '../src/systems/medals';
import { formatTime } from '../src/math/util';

describe('event bus', () => {
  it('delivers, unsubscribes and supports once', () => {
    const bus = new EventBus<{ a: number }>();
    const fn = vi.fn();
    const off = bus.on('a', fn);
    bus.emit('a', 1);
    off();
    bus.emit('a', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    const once = vi.fn();
    bus.once('a', once);
    bus.emit('a', 3);
    bus.emit('a', 4);
    expect(once).toHaveBeenCalledWith(3);
    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe('state machine', () => {
  const make = (id: string, log: string[]): GameState => ({
    id,
    enter: () => void log.push(`enter:${id}`),
    exit: () => void log.push(`exit:${id}`),
    update: () => void log.push(`update:${id}`),
    pause: () => void log.push(`pause:${id}`),
    resume: () => void log.push(`resume:${id}`),
  });

  it('switches, pushes and pops states', () => {
    const log: string[] = [];
    const sm = new StateMachine<string>();
    sm.register('a', () => make('a', log)).register('b', () => make('b', log));
    sm.go('a');
    sm.push('b');
    sm.pop();
    sm.go('b');
    expect(log).toEqual([
      'enter:a',
      'pause:a',
      'enter:b',
      'exit:b',
      'resume:a',
      'exit:a',
      'enter:b',
    ]);
  });
});

describe('game loop', () => {
  it('runs a fixed number of physics steps per simulated second', () => {
    let steps = 0;
    const loop = new GameLoop(
      { fixedUpdate: () => steps++, update: () => undefined, render: () => undefined },
      120,
    );
    for (let i = 0; i < 60; i++) loop.tick(1 / 60);
    expect(steps).toBeGreaterThanOrEqual(119);
    expect(steps).toBeLessThanOrEqual(121);
  });
});

describe('i18n', () => {
  it('detects language and interpolates', () => {
    expect(detectLanguage(['it-IT', 'en'])).toBe('it');
    expect(detectLanguage(['fr-FR'])).toBe('en');
    const i = new I18n('en');
    expect(i.t('hud.checkpoint', { bonus: 12 })).toBe('Checkpoint +12s');
    i.apply('it');
    expect(i.t('menu.play')).toBe('Gioca');
  });
});

describe('helpers', () => {
  it('awards medals by time', () => {
    const m = { gold: 60, silver: 70, bronze: 80 };
    expect(medalFor(59, m)).toBe('gold');
    expect(medalFor(65, m)).toBe('silver');
    expect(medalFor(80, m)).toBe('bronze');
    expect(medalFor(81, m)).toBe('none');
  });

  it('formats times', () => {
    expect(formatTime(83.456)).toBe('1:23.45');
    expect(formatTime(NaN)).toBe('--:--.--');
  });
});
