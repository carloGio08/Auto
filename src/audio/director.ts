import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { Vehicle } from '../vehicle/vehicle';
import type { AudioEngine } from './audioEngine';

/** Maps run events to sounds; owns the car's continuous engine voice. */
export class AudioDirector {
  private readonly offs: (() => void)[] = [];
  private vehicle: Vehicle | null = null;
  private combo = 0;

  constructor(
    private readonly audio: AudioEngine,
    events: EventBus<GameEvents>,
  ) {
    const sfx = () => this.audio.sfx;
    this.offs.push(
      events.on('run:countdown', ({ value }) => sfx()?.countdown(value === 0)),
      events.on('collectible:picked', ({ kind }) =>
        kind === 'coin' ? sfx()?.coin() : sfx()?.crystal(),
      ),
      events.on('checkpoint:passed', () => sfx()?.checkpoint()),
      events.on('style:trick', () => sfx()?.trick(this.combo)),
      events.on('style:combo', ({ multiplier }) => (this.combo = multiplier)),
      events.on('style:comboLost', () => {
        this.combo = 0;
        sfx()?.comboLost();
      }),
      events.on('vehicle:crash', ({ impact }) => sfx()?.impact(impact / 20)),
      events.on('vehicle:landed', ({ impact, airTime }) =>
        sfx()?.landing(Math.min(1, impact / 10 + airTime * 0.2)),
      ),
      events.on('vehicle:splash', ({ speed }) => sfx()?.splash(speed / 20)),
      events.on('vehicle:nearMiss', () => sfx()?.whoosh()),
      events.on('nitro:changed', ({ active }) => {
        if (active) sfx()?.nitroStart();
      }),
      events.on('hazard:triggered', () => sfx()?.rumble()),
      events.on('medal:awarded', ({ medal }) => sfx()?.medal(medal)),
      events.on('achievement:unlocked', () => sfx()?.achievement()),
    );
  }

  startEngine(vehicle: Vehicle): void {
    this.vehicle = vehicle;
    if (!vehicle.engine) {
      const character =
        vehicle.def.look.body === 'truck' ? 0.9 : vehicle.def.look.body === 'buggy' ? 0.2 : 0.5;
      vehicle.engine = this.audio.createEngine(character);
    }
    this.audio.music?.play('drive');
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    if (this.vehicle) {
      this.audio.releaseEngine(this.vehicle.engine);
      this.vehicle.engine = null;
    }
  }
}
