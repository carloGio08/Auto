import type { Handler } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { SystemId } from '../data/types';
import type { RunSession } from '../game/session';

/**
 * A gameplay mechanic plugged into a run. Modes list the system ids they want; the session
 * creates them from the registry in systems/index.ts. Systems never import each other: they
 * communicate through the session's event bus.
 */
export interface GameSystem {
  readonly id: SystemId;
  init(session: RunSession): void;
  /** Fixed-rate logic (120 Hz) after the physics step. */
  fixedUpdate?(dt: number): void;
  /** Per-frame logic (visuals, HUD data). */
  update?(dt: number, alpha: number): void;
  /** Called after the car is respawned at a safe spot. */
  onReset?(): void;
  /** Contributes lines to the results screen. */
  summary?(): { label: string; value: string }[];
  dispose(): void;
}

/** Convenience base class: event subscriptions are removed automatically on dispose. */
export abstract class BaseSystem implements GameSystem {
  abstract readonly id: SystemId;
  protected session!: RunSession;
  private readonly offs: (() => void)[] = [];

  init(session: RunSession): void {
    this.session = session;
    this.setup();
  }

  /** Override to subscribe to events and create visuals. */
  protected abstract setup(): void;

  /** Subscribes to a game event for the lifetime of the system. */
  protected onEvent<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): void {
    this.offs.push(this.session.events.on(type, handler));
  }

  dispose(): void {
    this.offs.forEach((off) => off());
    this.offs.length = 0;
    this.teardown();
  }

  /** Override to release visuals. */
  protected teardown(): void {}
}
