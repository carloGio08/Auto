/**
 * Screen/game state machine. Each state is a class implementing GameState; states are
 * registered by id and switched with `go(id, params)`. Overlay states (e.g. Paused) can be
 * pushed on top of another state with `push`, which keeps the state below alive.
 */
export interface GameState<Id extends string = string> {
  readonly id: Id;
  enter(params?: unknown): void | Promise<void>;
  exit(): void;
  /** Variable-rate update, alpha = interpolation factor between the last two fixed steps. */
  update(dt: number, alpha: number): void;
  /** Fixed-rate simulation step (only the top state receives it). */
  fixedUpdate?(dt: number): void;
  /** Called on the state below when an overlay is pushed / popped. */
  pause?(): void;
  resume?(): void;
  /** If true, states underneath keep receiving `update` (e.g. to render a frozen scene). */
  readonly transparent?: boolean;
}

export type StateFactory<Id extends string> = () => GameState<Id>;

export class StateMachine<Id extends string> {
  private readonly factories = new Map<Id, StateFactory<Id>>();
  private readonly stack: GameState<Id>[] = [];
  private transitioning = false;
  private pending: (() => void) | null = null;
  onChange: ((id: Id) => void) | null = null;

  register(id: Id, factory: StateFactory<Id>): this {
    this.factories.set(id, factory);
    return this;
  }

  has(id: Id): boolean {
    return this.factories.has(id);
  }

  get current(): GameState<Id> | undefined {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Replaces the whole stack with a new state. */
  go(id: Id, params?: unknown): void {
    this.schedule(() => {
      while (this.stack.length) this.stack.pop()!.exit();
      return this.enterNew(id, params);
    });
  }

  /** Pushes an overlay state on top of the current one. */
  push(id: Id, params?: unknown): void {
    this.schedule(() => {
      this.current?.pause?.();
      return this.enterNew(id, params);
    });
  }

  /** Pops the top overlay state and resumes the one below. */
  pop(): void {
    this.schedule(() => {
      const top = this.stack.pop();
      top?.exit();
      this.current?.resume?.();
      if (this.current) this.onChange?.(this.current.id);
    });
  }

  fixedUpdate(dt: number): void {
    this.current?.fixedUpdate?.(dt);
  }

  update(dt: number, alpha: number): void {
    const n = this.stack.length;
    if (n === 0) return;
    // Update transparent overlays and the first opaque state below them.
    let first = n - 1;
    while (first > 0 && this.stack[first].transparent) first--;
    for (let i = first; i < n; i++) this.stack[i].update(i === n - 1 ? dt : 0, alpha);
  }

  private enterNew(id: Id, params?: unknown): void | Promise<void> {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Unknown state "${id}"`);
    const state = factory();
    this.stack.push(state);
    this.onChange?.(id);
    return state.enter(params);
  }

  private schedule(action: () => void | Promise<void>): void {
    if (this.transitioning) {
      // Keep only the latest requested transition.
      this.pending = () => this.schedule(action);
      return;
    }
    this.transitioning = true;
    const done = (): void => {
      this.transitioning = false;
      const next = this.pending;
      this.pending = null;
      next?.();
    };
    try {
      const result = action();
      if (result instanceof Promise) {
        result.catch((err: unknown) => console.error('State transition failed', err)).finally(done);
      } else done();
    } catch (err) {
      console.error('State transition failed', err);
      done();
    }
  }
}
