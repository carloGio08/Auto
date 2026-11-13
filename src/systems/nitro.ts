import { config } from '../config';
import { BaseSystem } from './system';

/** Nitro tank: refilled by stylish driving, burnt for extra thrust. */
export class NitroSystem extends BaseSystem {
  readonly id = 'nitro' as const;
  amount = 0;
  private capacity = 1;
  private active = false;
  private wasFull = false;

  protected setup(): void {
    const n = config.gameplay.nitro;
    this.capacity = this.session.vehicle.physics.def.nitro.capacity;
    this.amount = n.startAmount * this.capacity;
    this.onEvent('vehicle:nearMiss', () => this.fill(n.nearMissRefill, 'nearMiss'));
    this.onEvent('vehicle:flip', ({ count }) => this.fill(n.flipRefill * count, 'flip'));
    this.onEvent(
      'vehicle:landed',
      ({ perfect }) => perfect && this.fill(n.perfectLandingRefill, 'landing'),
    );
    this.onEvent(
      'collectible:picked',
      ({ kind }) => kind === 'crystal' && this.fill(n.crystalRefill, 'crystal'),
    );
  }

  private fill(amount: number, reason: string): void {
    this.amount = Math.min(this.capacity, this.amount + amount * this.capacity);
    this.session.events.emit('nitro:fill', { amount, reason });
  }

  fixedUpdate(dt: number): void {
    const s = this.session;
    const car = s.vehicle.physics;
    const tel = s.vehicle.telemetry;
    const n = config.gameplay.nitro;
    if (s.phase === 'running') {
      if (tel.drifting) this.amount += n.driftRefillPerSecond * this.capacity * dt;
      if (tel.airborne) this.amount += n.airRefillPerSecond * this.capacity * dt;
    }
    const want = s.input.nitro && s.phase === 'running' && this.amount > 0.01;
    if (want) this.amount -= car.def.nitro.burnRate * dt;
    this.amount = Math.max(0, Math.min(this.capacity, this.amount));
    const active = want && this.amount > 0;
    car.nitroActive = active;
    if (active !== this.active) {
      this.active = active;
      if (active) {
        s.camera.kickFov(6);
        s.camera.addShake(0.15);
      }
      s.events.emit('nitro:changed', { amount: this.amount / this.capacity, active });
    }
  }

  update(): void {
    const full = this.amount >= this.capacity * 0.999;
    if (full && !this.wasFull)
      this.session.events.emit('ui:toast', { text: 'toast.nitroFull', tone: 'info' });
    this.wasFull = full;
    this.session.events.emit('nitro:changed', {
      amount: this.amount / this.capacity,
      active: this.active,
    });
  }

  onReset(): void {
    this.session.vehicle.physics.nitroActive = false;
  }

  protected override teardown(): void {
    this.session.vehicle.physics.nitroActive = false;
  }
}
