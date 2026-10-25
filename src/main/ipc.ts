import type { IpcMain, WebContents } from 'electron'
import type { Backend } from '../backend'
import { EVENT_NAMES, callChannel, eventChannel } from '../shared/api'

/**
 * Exposes every call of the backend API on its own IPC channel and forwards
 * every pushed event to the interface. Only the given web contents may call.
 * Returns a function that removes the handlers and listeners.
 */
export function bindBackendToIpc(backend: Backend, ipcMain: IpcMain, contents: WebContents): () => void {
  const channels: string[] = []
  for (const [service, methods] of Object.entries(backend.api)) {
    for (const [method, fn] of Object.entries(methods as Record<string, (...args: unknown[]) => unknown>)) {
      const channel = callChannel(service, method)
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (event.sender !== contents) throw new Error(`Refused ${channel} from an unknown sender`)
        return fn(...args)
      })
      channels.push(channel)
    }
  }

  const unsubscribers = EVENT_NAMES.map((name) =>
    backend.on(name, (payload) => {
      if (!contents.isDestroyed()) contents.send(eventChannel(name), payload)
    })
  )

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
