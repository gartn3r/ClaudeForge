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

/** How the user tidied one Session in ClaudeForge; Claude Code's files never hold it. */
export interface SessionPreferences {
  /** The user's name for the Session, shown over Claude Code's. */
  title?: string
  hidden?: boolean
}

/** How the Map panel shows a Map: one level as a graph, or the whole hierarchy as a tree. */
export type MapView = 'graph' | 'tree'

/** How the user last looked at one Map; a field left out is the default. */
export interface MapPreferences {
  /** Absent: the graph. */
  view?: 'tree'
  /** The Tree view leaves closed Tickets out. */
  hideClosed?: true
  /** Ids of the Tickets folded in the Tree view; every other one shows its Sub-tickets. */
  folded?: string[]
}

export interface AppState {
  version: 1
  layout: Record<PanelId, PanelLayout>
  /** The `claude` the user chose, or null to look for it. */
  claudePath: string | null
  /** Whether the terminal renders with WebGL; off falls back to the DOM renderer, for GPUs that garble text. */
  gpuRendering: boolean
  /** By Session id; a Session the user never tidied has no entry. */
  sessions: Record<string, SessionPreferences>
  /** By Project folder, then Map id; a Map the user never changed has no entry. */
  maps: Record<string, Record<string, MapPreferences>>
}

/** A partial update of the app state; nested objects merge. */
export interface AppStatePatch {
  layout?: Partial<Record<PanelId, Partial<PanelLayout>>>
  claudePath?: string | null
  gpuRendering?: boolean
  /** By Session id: a null field drops that preference, a null entry every one of them. */
  sessions?: Record<string, { title?: string | null; hidden?: boolean | null } | null>
  /** By Project folder, then Map id: a default value or null drops that preference, a null entry every one of them. */
  maps?: Record<string, Record<string, { view?: MapView | null; hideClosed?: boolean | null; folded?: string[] | null } | null>>
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
  /** GitHub Issues, read through the user's `gh` in the Project's folder. */
  | { kind: 'github' }
  /** A declared Tracker ClaudeForge cannot read yet, with its name when the declaration gives one. */
  | { kind: 'unsupported'; name: string | null }

export interface MapSummary {
  /** Unique within the Project: for local markdown, the effort's folder name; for GitHub, the issue number. */
  id: string
  name: string
  /** The Map's file (local markdown) or URL. */
  path: string
  /** Last change to the Map or any of its Tickets, in ms since the epoch. */
  updatedAt: number
  /** False once every Ticket is closed. */
  open: boolean
}

/** Why a Tracker's Maps cannot be read right now. */
export type TrackerProblem =
  /** The GitHub CLI is not installed. */
  | 'gh-missing'
  | 'gh-signed-out'
  /** `gh` finds no GitHub repository for the Project's folder. */
  | 'no-github-repository'
  /** Any other failure of `gh`, such as GitHub being unreachable. */
  | 'gh-failed'

export interface MapListing {
  tracker: Tracker
  /** Present when the Maps cannot be read; `maps` is then empty. */
  problem?: TrackerProblem
  /** Most recently updated first. */
  maps: MapSummary[]
}

export type TicketType = 'research' | 'prototype' | 'grilling' | 'task'

/**
 * A Ticket's derived state, in precedence order: closed, blocked (by its own open blockers or an
 * ancestor's), parent (open Sub-tickets: never on the Frontier, ADR 0004), claimed, Frontier.
 */
export type TicketState = 'closed' | 'blocked' | 'parent' | 'claimed' | 'frontier'

/** What lies beneath a Parent Ticket, at every depth. */
export interface TicketRollup {
  /** Its own Sub-tickets, one level down. */
  subTickets: number
  /** Every Ticket beneath it. */
  total: number
  closed: number
  claimed: number
  frontier: number
}

export interface Ticket {
  /**
   * Unique within the Map: for local markdown, the file's number (`03`); for GitHub, the issue
   * number (`42`), or `owner/repo#42` for an issue of another repository.
   */
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
  /** The id of the Ticket it is a Sub-ticket of; null for a Ticket of the Map itself. */
  parent: string | null
  state: TicketState
  /** Frontier, or claimed by the current user. */
  workable: boolean
  /** How many of its blockers are still open. */
  openBlockers: number
  /** An ancestor has an open blocker, which blocks this Ticket too ("parent waits"). */
  parentWaits: boolean
  /** Present on a Parent Ticket: one with open Sub-tickets. */
  rollup: TicketRollup | null
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
  /** Every Ticket at every level, in Map order; each names its parent. */
  tickets: Ticket[]
  /** Ids of the closed Tickets, in Map order: the Decided strip of their level. */
  decided: string[]
  /** Edges between open Tickets of one level, transitively reduced: what the graph draws. */
  liveEdges: TicketEdge[]
  /** Edges of one level touching a closed Ticket, transitively reduced: drawn on demand. */
  spentEdges: TicketEdge[]
}

/** Where the first-run screen sends the user to install or update Claude Code. */
export const CLAUDE_CODE_INSTALLATION_GUIDE = 'https://code.claude.com/docs/en/setup'

/** The oldest Claude Code ClaudeForge supports. */
export const MINIMUM_CLAUDE_CODE_VERSION = '2.1.0'

/** The `claude` ClaudeForge runs, or why there is none it can run. */
export type ClaudeCodeStatus =
  | { state: 'found'; path: string; version: string }
  | { state: 'outdated'; path: string; version: string; minimumVersion: string }
  | { state: 'missing'; lookedIn: string[] }

/** Where a Session's `claude` process is: none (past) or outside ClaudeForge (External). */
export type SessionState = 'past' | 'external'

/**
 * The Map, and the Ticket when one is named, that a Session works on: from its latest
 * `/wayfinder` invocation, resolved against its Project's Maps, never from Tracker assignees (ADR 0002).
 */
export interface WayfinderLink {
  mapId: string
  mapName: string
  ticket: { id: string; name: string } | null
}

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
  /** Hidden by the user: the explorer lists it only when asked to show hidden Sessions. */
  hidden: boolean
  /** What the Session works on, when its latest `/wayfinder` invocation names one of its Project's Maps. */
  wayfinder: WayfinderLink | null
}

/** What came of asking to delete a Session: only a past one can be, so nothing running is ever lost. */
export type SessionDeletion =
  | { deleted: true }
  | { deleted: false; reason: Exclude<SessionState, 'past'> | 'unknown' }

/** A Project and its Sessions, the most recently active first. */
export interface ProjectSessions {
  path: string
  name: string
  sessions: SessionSummary[]
}

/** A terminal's size in character cells. */
export interface TerminalSize {
  cols: number
  rows: number
}

/** A Hosted session as the Session host started it. */
export interface HostedSession {
  /** ClaudeForge's id for the Hosted session, not Claude Code's session id. */
  id: string
  /** The pseudoconsole behind the terminal, as xterm.js's `windowsPty` option takes it; null off Windows. */
  windowsPty: { backend: 'conpty'; buildNumber: number } | null
}

export type ExtensionKind = 'skill' | 'subagent' | 'mcp-server' | 'plugin'

/** Where an Extension applies: every Project (the user's, "global"), or the displayed Project only. */
export type ExtensionScope = 'global' | 'project'

/** An MCP server's health, as `claude mcp list` reports it. */
export type McpServerStatus =
  | 'connected'
  /** Waits for the user to sign in (`/mcp`). */
  | 'needs-sign-in'
  /** Would not start or connect, or connected without its tools. */
  | 'failed'
  /** A Project's `.mcp.json` server the user has not approved yet. */
  | 'pending-approval'
  /** Rejected, or disabled for the Project. */
  | 'disabled'
  /** A status ClaudeForge does not know yet; its `detail` gives Claude Code's words. */
  | 'unknown'

export interface Extension {
  kind: ExtensionKind
  name: string
  scope: ExtensionScope
  /** The plugin that brings it, else null: it is the user's or the Project's own. */
  plugin: string | null
  description: string | null
  /** MCP servers only. */
  mcp?: {
    status: McpServerStatus
    /** Claude Code's own words for the status, e.g. "Failed to connect". */
    detail: string
  }
  /** Plugins only: false when installed but disabled, so it brings nothing. */
  enabled?: boolean
}

/** Every Extension a new Session in a Project gets, global and Project-scoped. */
export interface ExtensionListing {
  /** By kind, then name. */
  extensions: Extension[]
  /** Set when `claude` could not list MCP servers or plugins; the listing then lacks them. */
  problem?: 'claude-failed'
}

/**
 * What a Hosted session's `claude` is doing: idle until the user first sends it something, working
 * while it streams a turn, done once that turn is over.
 */
export type HostedSessionStatus = 'idle' | 'working' | 'done'

export interface BackendApi {
  sessionHost: {
    /** Asks the user for a Project folder ("Open folder"); null when they cancel. */
    chooseProject(): Promise<string | null>
    /** Starts `claude`, with no extra options, in a Project; its output and exit arrive as events. */
    start(project: string, size: TerminalSize): Promise<HostedSession>
    /** Types into the Hosted session's terminal. */
    write(id: string, data: string): Promise<void>
    resize(id: string, size: TerminalSize): Promise<void>
    /** Ends the Hosted session's `claude`; its exit event follows. */
    stop(id: string): Promise<void>
  }
  map: {
    /** Detects the Project's Tracker and lists its Maps. */
    list(project: string): Promise<MapListing>
    load(project: string, mapId: string): Promise<WayfinderMap>
  }
  extensions: {
    /** Lists the Extensions of a Project, through Claude Code's CLI for MCP servers and plugins. */
    list(project: string): Promise<ExtensionListing>
  }
  appState: {
    read(): Promise<AppState>
    write(patch: AppStatePatch): Promise<AppState>
  }
  sessions: {
    /** Every Session on the machine, grouped by Project, the most recently active Project first. */
    list(): Promise<ProjectSessions[]>
    /** Names the Session in ClaudeForge only; an empty title gives it back Claude Code's name. */
    rename(id: string, title: string): Promise<void>
    /** Hides the Session from the explorer's list, or shows it again. */
    setHidden(id: string, hidden: boolean): Promise<void>
    /** Moves a past Session's history files to the Windows Recycle Bin; refused for any other. */
    delete(id: string): Promise<SessionDeletion>
  }
  system: {
    info(): Promise<SystemInfo>
  }
  claudeCode: {
    /** Looks for `claude` (at the path the user chose, then on PATH) and checks its version. */
    locate(): Promise<ClaudeCodeStatus>
    /** Lets the user pick `claude.exe` in a file dialog, remembers it in app state, then locates again. */
    choose(): Promise<ClaudeCodeStatus>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
}

export interface BackendEvents {
  /** What a Hosted session's terminal printed. */
  'sessionHost.output': { id: string; data: string }
  /** A Hosted session's `claude` ended. */
  'sessionHost.exit': { id: string; exitCode: number }
  /** A Hosted session's status changed; every Hosted session starts idle. */
  'sessionHost.status': { id: string; status: HostedSessionStatus }
  'appState.changed': AppState
  /** The whole Session catalog, after Claude Code's files changed it. */
  'sessions.changed': ProjectSessions[]
  'window.maximizedChanged': { maximized: boolean }
}

export type EventName = keyof BackendEvents

// A record, so adding an event to BackendEvents without listing it here fails to compile.
const EVENTS: Record<EventName, true> = {
  'sessionHost.output': true,
  'sessionHost.exit': true,
  'sessionHost.status': true,
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
