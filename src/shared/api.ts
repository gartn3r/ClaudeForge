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

/** Holds a panel width within its bounds, in whole pixels. */
export function clampPanelWidth(panel: PanelId, width: number): number {
  const { min, max } = PANEL_BOUNDS[panel]
  return Math.round(Math.min(max, Math.max(min, width)))
}

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
}

/** Where a Session's `claude` process is: none (past) or outside ClaudeForge (External). */
export type SessionState = 'past' | 'external'

/** One Session, as the explorer lists it. */
export interface SessionSummary {
  id: string
  /** Claude Code's name for the Session, else the start of its first message; null when it has neither yet. */
  title: string | null
  /** The folder the Session runs in: its Project, or one of the Project's git worktrees. */
  cwd: string
  /** The worktree's name when the Session runs in a git worktree of its Project. */
  worktree: string | null
  /** When the Session was last active, in milliseconds since the epoch. */
  lastActivity: number
  state: SessionState
}

/** A Project and its Sessions, the most recently active first. */
export interface ProjectSessions {
  path: string
  name: string
  sessions: SessionSummary[]
}

export interface BackendApi {
  appState: {
    read(): Promise<AppState>
    write(patch: AppStatePatch): Promise<AppState>
  }
  sessions: {
    /** Every Session on the machine, grouped by Project, the most recently active Project first. */
    list(): Promise<ProjectSessions[]>
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
  /** The whole Session catalog, after Claude Code's files changed it. */
  'sessions.changed': ProjectSessions[]
  'window.maximizedChanged': { maximized: boolean }
}

export type EventName = keyof BackendEvents

// A record, so adding an event to BackendEvents without listing it here fails to compile.
const EVENTS: Record<EventName, true> = {
  'appState.changed': true,
  'sessions.changed': true,
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
