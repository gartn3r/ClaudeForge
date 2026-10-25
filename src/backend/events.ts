import type { BackendEvents, EventName } from '../shared/api'

export type Listener<E extends EventName> = (payload: BackendEvents[E]) => void

/** A minimal typed event emitter for the backend's pushed events. */
export class BackendEventEmitter {
  private readonly listeners = new Map<EventName, Set<Listener<never>>>()

  on<E extends EventName>(event: E, listener: Listener<E>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<never>)
    return () => set.delete(listener as Listener<never>)
  }

  emit<E extends EventName>(event: E, payload: BackendEvents[E]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      ;(listener as Listener<E>)(payload)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
