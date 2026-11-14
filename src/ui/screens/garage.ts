import type { GameContext } from '../../core/context';
import type { CarDef, UpgradeId } from '../../data/types';
import { MAX_UPGRADE_LEVEL } from '../../data/upgrades';
import { accessories, FREE_PAINTS, PAINT_PRICE } from '../../data/accessories';
import { config } from '../../config';
import { accessoriesOn, configuredJeep, ownedAccessories } from '../../game/progression';
import { h } from '../dom';
import { button, header, iconButton, statBar } from '../components';
import { icon } from '../icons';
import type { Screen } from '../uiManager';

export interface GarageCallbacks {
  onBack(): void;
  /** Preview a car/colour in the 3D scene. */
  preview(car: CarDef, color: string): void;
  recolor(color: string): void;
}

/** Car selection, purchase, paint and upgrades. */
export function createGarage(ctx: GameContext, cb: GarageCallbacks): Screen {
  const t = ctx.i18n.t;
  const tk = ctx.i18n.tk;
  const save = ctx.save.data;
  const cars = ctx.registries.cars.all();
  let index = Math.max(
    0,
    cars.findIndex((c) => c.id === save.selectedCar),
  );
  const panel = h('div', { class: 'garage-panel' });
  const coins = h('span', { class: 'coin-count' });

  const render = (): void => {
    const car = cars[index];
    const owned = save.ownedCars.includes(car.id);
    const selected = save.selectedCar === car.id;
    const lockedBy =
      car.requiresAchievement &&
      !config.dev.unlockAll &&
      !save.achievements.includes(car.requiresAchievement)
        ? ctx.registries.achievements.get(car.requiresAchievement)
        : null;
    coins.replaceChildren(h('span', { class: 'ico', html: icon('coin') }), String(save.coins));
    const color = save.carColors[car.id] ?? car.look.colors[0];

    let action: HTMLElement;
    if (owned) {
      action = button(
        selected ? t('common.selected') : t('common.select'),
        () => {
          save.selectedCar = car.id;
          ctx.save.save();
          render();
        },
        {
          cls: selected ? 'ghost' : 'primary',
          disabled: selected,
          icon: selected ? 'check' : undefined,
        },
      );
    } else if (lockedBy) {
      action = h(
        'div',
        { class: 'locked-note' },
        h('span', { class: 'ico', html: icon('lock') }),
        t('garage.requires', { name: tk(lockedBy.nameKey) }),
      );
    } else {
      action = button(
        `${t('common.buy')} · ${car.price}`,
        () => {
          if (save.coins < car.price) {
            ctx.ui.toast(t('garage.notEnough'), 'bad');
            ctx.audio.sfx?.uiError();
            return;
          }
          save.coins -= car.price;
          save.ownedCars.push(car.id);
          save.selectedCar = car.id;
          ctx.save.save();
          ctx.audio.sfx?.purchase();
          ctx.ui.toast(t('garage.bought', { name: tk(car.nameKey) }), 'good');
          render();
        },
        { cls: 'primary', icon: 'coin' },
      );
    }

    const pay = (price: number): boolean => {
      if (save.coins < price) {
        ctx.ui.toast(t('garage.notEnough'), 'bad');
        ctx.audio.sfx?.uiError();
        return false;
      }
      save.coins -= price;
      ctx.audio.sfx?.purchase();
      return true;
    };
    const refresh = (): void => {
      ctx.save.save();
      cb.preview(configuredJeep(save, car), save.carColors[car.id] ?? car.look.colors[0]);
      render();
    };

    // Paints: the first ones are free, the others are bought once per jeep.
    const swatches = h(
      'div',
      { class: 'swatches' },
      ...car.look.colors.map((c, i) => {
        const ownedPaint = ctx.save.ownsPaint(car.id, c, i, FREE_PAINTS);
        return h(
          'button',
          {
            class: `swatch ${c === color ? 'active' : ''} ${ownedPaint ? '' : 'locked'}`,
            style: `background:${c}`,
            'aria-label': ownedPaint ? c : `${c} · ${PAINT_PRICE}`,
            title: ownedPaint ? '' : `${t('common.buy')} · ${PAINT_PRICE}`,
            type: 'button',
            onclick: () => {
              if (!ownedPaint) {
                if (!owned || !pay(PAINT_PRICE)) return;
                (save.paints[car.id] ??= []).push(c);
                ctx.ui.toast(t('garage.paintBought'), 'good');
              }
              save.carColors[car.id] = c;
              ctx.save.save();
              cb.recolor(c);
              render();
            },
          },
          ownedPaint ? '' : h('span', { class: 'swatch-price', html: icon('coin') }),
        );
      }),
    );

    // Accessories: factory ones are owned; others bought once, then switched on and off.
    const ownedAcc = ownedAccessories(save, car);
    const onAcc = accessoriesOn(save, car);
    const accessoryRows = accessories.map((a) => {
      const has = ownedAcc.includes(a.id);
      const on = onAcc.includes(a.id);
      const needs = a.requires && !onAcc.includes(a.requires);
      const btn = has
        ? button(
            on ? t('common.on') : t('common.off'),
            () => {
              const next = on ? onAcc.filter((x) => x !== a.id) : [...onAcc, a.id];
              // Cargo sits on the roof rack: removing the rack removes the cargo.
              save.accessoriesOn[car.id] =
                a.id === 'roofRack' && on ? next.filter((x) => x !== 'cargo') : next;
              refresh();
            },
            { cls: `small ${on ? 'primary' : 'ghost'}`, disabled: !owned || (!on && !!needs) },
          )
        : button(
            String(a.price),
            () => {
              if (!pay(a.price)) return;
              (save.accessories[car.id] ??= []).push(a.id);
              save.accessoriesOn[car.id] = [...onAcc, a.id];
              if (a.requires && !onAcc.includes(a.requires))
                save.accessoriesOn[car.id].push(a.requires);
              if (a.requires && !ownedAcc.includes(a.requires))
                (save.accessories[car.id] ??= []).push(a.requires);
              ctx.ui.toast(t('garage.bought', { name: tk(a.nameKey) }), 'good');
              refresh();
            },
            {
              cls: 'small',
              disabled: !owned || !!(a.requires && !ownedAcc.includes(a.requires)),
              icon: 'coin',
            },
          );
      return h('div', { class: 'upgrade accessory' }, h('div', {}, h('b', {}, tk(a.nameKey))), btn);
    });

    const upgrades = ctx.registries.upgrades.all().map((u) => {
      const level = ctx.save.upgradeLevel(car.id, u.id as UpgradeId);
      const maxed = level >= MAX_UPGRADE_LEVEL;
      const cost = maxed ? 0 : u.costs[level];
      const pips = h(
        'span',
        { class: 'pips' },
        ...Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) =>
          h('i', { class: i < level ? 'on' : '' }),
        ),
      );
      const buy = button(
        maxed ? t('garage.max') : String(cost),
        () => {
          if (save.coins < cost) {
            ctx.ui.toast(t('garage.notEnough'), 'bad');
            ctx.audio.sfx?.uiError();
            return;
          }
          save.coins -= cost;
          (save.upgrades[car.id] ??= {})[u.id] = level + 1;
          ctx.save.save();
          ctx.audio.sfx?.purchase();
          ctx.ui.toast(t('garage.upgraded', { name: tk(u.nameKey) }), 'good');
          render();
        },
        { cls: 'small', disabled: maxed || !owned, icon: maxed ? undefined : 'coin' },
      );
      return h(
        'div',
        { class: 'upgrade' },
        h('div', {}, h('b', {}, tk(u.nameKey)), h('small', {}, tk(u.descriptionKey))),
        pips,
        buy,
      );
    });

    panel.replaceChildren(
      h(
        'div',
        { class: 'car-nav' },
        iconButton('left', 'prev', () => go(-1)),
        h('h3', {}, tk(car.nameKey)),
        iconButton('right', 'next', () => go(1)),
      ),
      h('p', { class: 'muted' }, tk(car.descriptionKey)),
      h(
        'p',
        { class: 'muted small' },
        `${car.physics.mass} kg · 4x4 · ${Math.round(car.physics.suspension.maxTravel * 100)} cm`,
      ),
      h(
        'div',
        { class: 'stats' },
        statBar(t('garage.stats.speed'), car.stats.speed),
        statBar(t('garage.stats.grip'), car.stats.grip),
        statBar(t('garage.stats.suspension'), car.stats.suspension),
        statBar(t('garage.stats.weight'), car.stats.weight),
      ),
      action,
      h('h4', {}, t('garage.color')),
      swatches,
      h('h4', {}, t('garage.accessories')),
      h('div', { class: 'upgrades' }, ...accessoryRows),
      h('h4', {}, t('garage.upgrades')),
      h('div', { class: 'upgrades' }, ...upgrades),
    );
  };
  const go = (d: number): void => {
    index = (index + d + cars.length) % cars.length;
    const car = cars[index];
    cb.preview(configuredJeep(save, car), save.carColors[car.id] ?? car.look.colors[0]);
    render();
  };
  render();
  cb.preview(
    configuredJeep(save, cars[index]),
    save.carColors[cars[index].id] ?? cars[index].look.colors[0],
  );
  const el = h(
    'div',
    { class: 'screen garage' },
    header(t('garage.title'), cb.onBack, coins),
    h('div', { class: 'garage-side scroll' }, panel),
  );
  return { el, onBack: cb.onBack };
}
