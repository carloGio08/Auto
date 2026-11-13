/**
 * Minimal strongly typed event bus. The event map is a record of event name → payload type.
 * Handlers can be removed with the returned unsubscribe function.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  once<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    // Iterate over a snapshot so handlers may unsubscribe while being called.
    for (const h of [...set]) (h as Handler<Events[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }

  listenerCount<K extends keyof Events>(type: K): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}
