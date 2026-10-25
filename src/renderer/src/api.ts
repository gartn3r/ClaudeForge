import {
  callChannel,
  eventChannel,
  type BackendApi,
  type BackendEvents,
  type Bridge,
  type EventName
} from '../../shared/api'

declare global {
  interface Window {
    claudeforge: Bridge
  }
}

/** The typed backend API client: `api.appState.read()` becomes an IPC call. */
export const api = new Proxy({} as BackendApi, {
  get: (_target, service: string) =>
    new Proxy(
      {},
      {
        get:
          (_methods, method: string) =>
          (...args: unknown[]) =>
            window.claudeforge.call(callChannel(service, method), ...args)
      }
    )
})

/** Subscribes to one pushed event; returns the unsubscribe function. */
export function onEvent<E extends EventName>(
  event: E,
  listener: (payload: BackendEvents[E]) => void
): () => void {
  return window.claudeforge.on(eventChannel(event), listener as (payload: unknown) => void)
}
