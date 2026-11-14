import { h } from './dom';
import { icon } from './icons';

export function button(
  label: string,
  onClick: () => void,
  opts: { icon?: string; cls?: string; disabled?: boolean; title?: string } = {},
): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn ${opts.cls ?? ''}`,
      onclick: () => onClick(),
      disabled: opts.disabled,
      title: opts.title,
      type: 'button',
    },
    opts.icon ? h('span', { class: 'btn-ico', html: icon(opts.icon) }) : null,
    h('span', { class: 'btn-label' }, label),
  );
}

export function iconButton(
  name: string,
  label: string,
  onClick: () => void,
  cls = '',
): HTMLButtonElement {
  return h('button', {
    class: `icon-btn ${cls}`,
    'aria-label': label,
    title: label,
    onclick: () => onClick(),
    type: 'button',
    html: icon(name),
  });
}

/** Header with back button and title. */
export function header(
  title: string,
  onBack: (() => void) | null,
  extra?: HTMLElement,
): HTMLElement {
  return h(
    'header',
    { class: 'screen-header' },
    onBack ? iconButton('back', 'Back', onBack, 'back-btn') : null,
    h('h2', {}, title),
    extra ?? null,
  );
}

/** A row with a label and an option stepper (◀ value ▶), navigable with left/right. */
export function stepper<T>(
  label: string,
  options: { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  let index = Math.max(
    0,
    options.findIndex((o) => o.value === current),
  );
  const valueEl = h('span', { class: 'stepper-value' }, options[index].label);
  const set = (i: number): void => {
    index = (i + options.length) % options.length;
    valueEl.textContent = options[index].label;
    onChange(options[index].value);
  };
  const control = h(
    'div',
    {
      class: 'stepper',
      'data-adjust': '',
      'data-nav': '',
      tabindex: 0,
      role: 'group',
      'aria-label': label,
    },
    h('button', {
      class: 'stepper-arrow silent',
      tabindex: -1,
      'aria-label': 'previous',
      html: icon('left'),
      onclick: () => set(index - 1),
      type: 'button',
    }),
    valueEl,
    h('button', {
      class: 'stepper-arrow silent',
      tabindex: -1,
      'aria-label': 'next',
      html: icon('right'),
      onclick: () => set(index + 1),
      type: 'button',
    }),
  );
  control.addEventListener('nav-adjust', (e) => set(index + (e as CustomEvent<number>).detail));
  control.addEventListener('click', (e) => {
    if (e.target === control || e.target === valueEl) set(index + 1);
  });
  return h('div', { class: 'row' }, h('label', {}, label), control);
}

/** Slider 0..1 with keyboard/gamepad adjust. */
/** Slider with keyboard/gamepad adjust. 0..1 ranges show a percentage, others a multiplier. */
export function slider(
  label: string,
  value: number,
  onChange: (v: number) => void,
  min = 0,
  max = 1,
  step = 0.05,
  formatter?: (v: number) => string,
): HTMLElement {
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    'aria-label': label,
    'data-adjust': '',
  }) as HTMLInputElement;
  const format = (v: number): string =>
    formatter
      ? formatter(v)
      : min === 0 && max === 1
        ? `${Math.round(v * 100)}%`
        : `${v.toFixed(2)}×`;
  const out = h('span', { class: 'slider-value' }, format(value));
  const update = (): void => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange(v);
  };
  input.addEventListener('input', update);
  input.addEventListener('nav-adjust', (e) => {
    input.value = String(
      Math.min(max, Math.max(min, Number(input.value) + (e as CustomEvent<number>).detail * step)),
    );
    update();
  });
  return h(
    'div',
    { class: 'row' },
    h('label', {}, label),
    h('div', { class: 'slider' }, input, out),
  );
}

export function toggle(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
  onText: string,
  offText: string,
): HTMLElement {
  return stepper(
    label,
    [
      { value: true, label: onText },
      { value: false, label: offText },
    ],
    value,
    onChange,
  );
}

export function statBar(label: string, value: number): HTMLElement {
  return h(
    'div',
    { class: 'stat' },
    h('span', {}, label),
    h(
      'div',
      { class: 'stat-bar' },
      h('div', { class: 'stat-fill', style: `width:${Math.round(value * 100)}%` }),
    ),
  );
}

export function medalBadge(medal: string, title: string): HTMLElement {
  return h('span', { class: `medal medal-${medal}`, title, html: icon('medal') });
}
