import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CALL_PREFIX, EVENT_PREFIX, type Bridge } from '../shared/api'

// The bridge carries only backend API channels; the interface builds its
// typed client on top of it (src/renderer/src/api.ts).
const bridge: Bridge = {
  call(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!channel.startsWith(CALL_PREFIX) || channel.startsWith(EVENT_PREFIX)) {
      return Promise.reject(new Error(`Not a backend API call: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!channel.startsWith(EVENT_PREFIX)) throw new Error(`Not a backend API event: ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.off(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('claudeforge', bridge)
