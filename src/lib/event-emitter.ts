/**
 * Lightweight typed event emitter — generic pub/sub for inter-module
 * communication without tight coupling.
 *
 * Usage:
 *   type Events = { 'stateChange': { isPlaying: boolean }; 'end': void };
 *   const emitter = new EventEmitter<Events>();
 *   const unsub = emitter.on('stateChange', (data) => { ... });
 *   emitter.emit('stateChange', { isPlaying: true });
 *   unsub(); // remove listener
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler<T> = T extends void ? () => void : (data: T) => void;

export class EventEmitter<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<Handler<unknown>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as Handler<unknown>);
    return () => { handlers.delete(handler as Handler<unknown>); };
  }

  /** Emit an event, calling all subscribed handlers. */
  emit<K extends keyof T>(event: K, ...[data]: T[K] extends void ? [] : [T[K]]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      (handler as Handler<T[K]>)(data as T[K]);
    }
  }

  /** Remove all listeners for a specific event, or all events if none specified. */
  clear(event?: keyof T): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
