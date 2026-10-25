// The typed backend API: the only way the interface reaches the machine.
// Every service is a set of request/response calls; the main process also
// pushes events. This file holds types and constants only, so the main
// process, the preload script, the interface and the tests all share it.

export type Language = 'en' | 'fr'

export const SUPPORTED_LANGUAGES: readonly Language[] = ['en', 'fr']

/** Width bounds of the side panels, in CSS pixels. */
export const PANEL_BOUNDS = {
  explorer: { min: 200, max: 420, default: 264 },
  map: { min: 320, max: 720, default: 400 }
} as const

/** Width of a collapsed side panel. */
export const RAIL_WIDTH = 40

export type PanelId = keyof typeof PANEL_BOUNDS

export interface PanelLayout {
  width: number
  collapsed: boolean
}

export interface AppState {
  version: 1
  layout: Record<PanelId, PanelLayout>
}

/** A partial update of the app state; nested objects merge. */
export interface AppStatePatch {
  layout?: Partial<Record<PanelId, Partial<PanelLayout>>>
}

export interface SystemInfo {
  /** Interface language, from the Windows display languages. */
  language: Language
  appVersion: string
}

export interface BackendApi {
  appState: {
    read(): Promise<AppState>
    write(patch: AppStatePatch): Promise<AppState>
  }
  system: {
    info(): Promise<SystemInfo>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
}

export interface BackendEvents {
  'appState.changed': AppState
  'window.maximizedChanged': { maximized: boolean }
}

export type ServiceName = keyof BackendApi
export type EventName = keyof BackendEvents

// A record, so adding an event to BackendEvents without listing it here fails to compile.
const EVENTS: Record<EventName, true> = {
  'appState.changed': true,
  'window.maximizedChanged': true
}

/** Every pushed event, for the IPC transport. */
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]

/** IPC channel of one call, e.g. `cf:appState.read`. */
export const callChannel = (service: string, method: string): string => `cf:${service}.${method}`

/** IPC channel of one pushed event, e.g. `cf:event:appState.changed`. */
export const eventChannel = (event: string): string => `cf:event:${event}`

export const CALL_PREFIX = 'cf:'
export const EVENT_PREFIX = 'cf:event:'

/** What the preload script exposes to the interface as `window.claudeforge`. */
export interface Bridge {
  call(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (payload: unknown) => void): () => void
}
