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
  /** The folder ClaudeForge was started in: the displayed Project until a Session is displayed. */
  startFolder: string
}

/** Where a Project keeps its Maps, from its `docs/agents/issue-tracker.md`. */
export type Tracker =
  | { kind: 'local-markdown' }
  /** A declared Tracker ClaudeForge cannot read yet, with its name when the declaration gives one. */
  | { kind: 'unsupported'; name: string | null }

export interface MapSummary {
  /** Unique within the Project; for local markdown, the effort's folder name. */
  id: string
  name: string
  /** The Map's file (local markdown) or URL. */
  path: string
  /** Last change to the Map or any of its Tickets, in ms since the epoch. */
  updatedAt: number
  /** False once every Ticket is closed. */
  open: boolean
}

export interface MapListing {
  tracker: Tracker
  /** Most recently updated first. */
  maps: MapSummary[]
}

export type TicketType = 'research' | 'prototype' | 'grilling' | 'task'

/** A Ticket's derived state, in precedence order: closed, blocked, claimed, Frontier. */
export type TicketState = 'closed' | 'blocked' | 'claimed' | 'frontier'

export interface Ticket {
  /** Unique within the Map; for local markdown, the file's number (`03`). */
  id: string
  name: string
  type: TicketType | null
  open: boolean
  claimed: boolean
  /** Who claimed it, when the Tracker names a person. */
  assignee: string | null
  /** Ids of the Tickets blocking this one, open or closed. */
  blockedBy: string[]
  path: string
  question: string
  answer: string
  state: TicketState
  /** Frontier, or claimed by the current user. */
  workable: boolean
  /** How many of its blockers are still open. */
  openBlockers: number
}

/** A "blocked by" relationship: `from` blocks `to`. */
export interface TicketEdge {
  from: string
  to: string
}

/** A Map in the Tracker-independent model, with its derived display sets. */
export interface WayfinderMap extends MapSummary {
  destination: string
  notes: string
  decisionsSoFar: string
  notYetSpecified: string
  outOfScope: string
  /** In Map order. */
  tickets: Ticket[]
  /** Ids of the closed Tickets, in Map order: the Decided strip. */
  decided: string[]
  /** Edges between open Tickets, transitively reduced: what the graph draws. */
  liveEdges: TicketEdge[]
  /** Edges touching a closed Ticket, transitively reduced: drawn on demand. */
  spentEdges: TicketEdge[]
}

export interface BackendApi {
  map: {
    /** Detects the Project's Tracker and lists its Maps. */
    list(project: string): Promise<MapListing>
    load(project: string, mapId: string): Promise<WayfinderMap>
  }
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
