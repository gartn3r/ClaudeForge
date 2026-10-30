// The typed backend API: the only way the interface reaches the machine.
// Every service is a set of request/response calls; the main process also
// pushes events. This file holds types and constants only, so the main
// process, the preload script, the interface and the tests all share it.

import type { ElementOp, ElementRequest, ElementResult } from './elements'

export type Language = 'en' | 'fr'

export const SUPPORTED_LANGUAGES: readonly Language[] = ['en', 'fr']

/** Width bounds of the side panels, in CSS pixels. */
export const PANEL_BOUNDS = {
  explorer: { min: 220, max: 480, default: 280 },
  map: { min: 340, max: 800, default: 440 }
} as const

/** Width of a collapsed side panel. */
export const RAIL_WIDTH = 68

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
export type MapPanelView = 'graph' | 'tree'

/** How the user last looked at one Map; a field left out is the default. */
export interface MapPreferences {
  /** Absent: the graph. */
  view?: 'tree'
  /** The Tree view leaves closed Tickets out. */
  hideClosed?: true
  /** Ids of the Tickets folded in the Tree view; every other one shows its Sub-tickets. */
  folded?: string[]
}

/** A Project's Map preferences, by Map id. */
export type ProjectMapPreferences = Record<string, MapPreferences>

/** A Hosted session's tab as ClaudeForge saves it, to come back dormant on the next start. */
export interface SavedTab {
  /** Claude Code's id for the Session, which `claude --resume` takes. */
  sessionId: string
  /** The Project the tab belongs to. */
  project: string
  /** The name Claude Code last gave its terminal; null when it gave none. */
  title: string | null
}

/**
 * The command a Skill shortcut types: a skill among the Extensions, as Claude Code names it
 * (`wayfinder`, `<plugin>:<skill>` for a plugin's), with optional arguments; or one written freely.
 */
export type ShortcutCommand = { mode: 'skill'; skill: string; args: string } | { mode: 'free'; text: string }

/**
 * An entry of the Shortcuts card, the same for every Project: a Web shortcut, opened in a Web tab
 * (ADR 0006), or a Skill shortcut, whose command is typed, never sent.
 */
export type Shortcut =
  | { id: string; name: string; kind: 'web'; address: string }
  | { id: string; name: string; kind: 'skill'; command: ShortcutCommand }

/**
 * Where the Work items card reads the Azure DevOps backlog, through the user's `az` (ADR 0008): one
 * configuration for every Project.
 */
export interface BacklogConfig {
  /** The organisation's address, as the browser shows it on Azure DevOps. */
  organization: string
  project: string
  /** The area the Work items are in, sub-areas included, as a Work item names it: `Acme\Acquisition`. */
  areaPath: string
  /** The iteration the sprints sit under, at any depth, as a Work item names it: `Acme\Retail\Team`. */
  iterationRoot: string
}

/**
 * A button beside each Work item in the Work items card: it types `/<skill> <text>`, never sent, into
 * a new Session of the displayed Project, the text's `{id}`, `{title}`, `{type}` and `{url}` filled.
 */
export interface WorkItemAction {
  id: string
  label: string
  /** A skill among the Extensions, as Claude Code names it (`<plugin>:<skill>` for a plugin's). */
  skill: string
  text: string
  /** `outline` or a `#rrggbb` colour; the first action is always lime whatever it holds. */
  colour: string
}

/** A sprint under the iteration root; its days as `YYYY-MM-DD`, both included. */
export interface Sprint {
  name: string
  /** As a Work item names its iteration. */
  path: string
  start: string
  finish: string
}

/** A Work item of the Current sprint, as the Work items card shows it. */
export interface WorkItem {
  id: number
  /** Azure DevOps' own name for it: `Product Backlog Item`, `Bug`, `BugInnovation`… */
  type: string
  state: string
  title: string
  /** Assigned to the user; otherwise it is unassigned. */
  assignedToMe: boolean
}

/** Why the backlog cannot be read through `az`. */
export type BacklogProblem =
  /** The Azure CLI is not installed. */
  | 'az-missing'
  /** `az` lacks its `azure-devops` extension. */
  | 'extension-missing'
  /** No one signed in to `az`. */
  | 'signed-out'
  /** Any other failure, such as an unknown organisation or Azure DevOps being unreachable. */
  | 'az-failed'

export type BacklogFailure = { ok: false; problem: BacklogProblem; detail: string }

/**
 * The Work items of the Current sprint, in backlog order: `sprint` is null when no sprint under the
 * iteration root is running or to come; `upcoming` when it is the next one, between two sprints.
 */
export type WorkItemListing = { ok: true; sprint: Sprint | null; upcoming: boolean; workItems: WorkItem[] } | BacklogFailure

/** What the configuration form offers to choose from, as a Work item names it. */
export type BacklogChoices = { ok: true; values: string[] } | BacklogFailure

/** The Azure DevOps backlog, read through the user's `az` with their own sign-in (ADR 0008); never written. */
export interface BacklogApi {
  /** The Current sprint under the iteration root and its Work items; the card asks only when a Project is displayed or the user refreshes. */
  workItems(config: BacklogConfig): Promise<WorkItemListing>
  /** The organisation's projects, by name. */
  projects(organization: string): Promise<BacklogChoices>
  /** The project's areas, its own root first. */
  areas(organization: string, project: string): Promise<BacklogChoices>
  /** The project's iterations that hold sprints beneath them, which can be the iteration root. */
  iterationRoots(organization: string, project: string): Promise<BacklogChoices>
}

/** Where every Web tab keeps its pages' storage, apart from the interface's: sign-ins survive a restart. */
export const WEB_TAB_PARTITION = 'persist:web-tabs'

/** The longest App title the user can give, which the title bar holds beside the tabs. */
export const APP_TITLE_MAX_LENGTH = 60

/** An App title as ClaudeForge keeps it: trimmed and cut short; null, for ClaudeForge's own name, once blank. */
export const tidyAppTitle = (title: string): string | null => title.trim().slice(0, APP_TITLE_MAX_LENGTH).trim() || null

/** How ClaudeForge looks: light, dark, or as Windows is set. */
export type Theme = 'light' | 'dark' | 'system'

export const THEMES: readonly Theme[] = ['light', 'dark', 'system']

export interface AppState {
  version: 1
  /** The App title the user gave, trimmed; null to show ClaudeForge's own name. */
  appTitle: string | null
  layout: Record<PanelId, PanelLayout>
  /** The `claude` the user chose, or null to look for it. */
  claudePath: string | null
  /** Whether the terminal renders with WebGL; off falls back to the DOM renderer, for GPUs that garble text. */
  gpuRendering: boolean
  /** Whether a background Hosted session that waits for the user or finishes raises a Windows notification. */
  notifications: boolean
  /** The Theme the user picked; `system` follows Windows. */
  theme: Theme
  /** By Session id; a Session the user never tidied has no entry. */
  sessions: Record<string, SessionPreferences>
  /** By Project folder, then Map id; a Map the user never changed has no entry. */
  maps: Record<string, ProjectMapPreferences>
  /** The Hosted session tabs open when ClaudeForge last ran, in tab order: dormant tabs to restore. */
  tabs: SavedTab[]
  /** The Shortcuts card, in the user's order. */
  shortcuts: Shortcut[]
  /** The Web tabs open when ClaudeForge last ran, in tab order, by their Web shortcut's id. */
  webTabs: string[]
  /** Where the Work items card reads the backlog; null until the user connects Azure DevOps. */
  backlog: BacklogConfig | null
  /** The Work item actions, in order: three at most, none until the user sets the first. */
  workItemActions: WorkItemAction[]
}

/** A partial update of the app state; nested objects merge. */
export interface AppStatePatch {
  /** A blank title or null gives back ClaudeForge's own name. */
  appTitle?: string | null
  layout?: Partial<Record<PanelId, Partial<PanelLayout>>>
  claudePath?: string | null
  gpuRendering?: boolean
  notifications?: boolean
  theme?: Theme
  /** By Session id: a null field drops that preference, a null entry every one of them. */
  sessions?: Record<string, { title?: string | null; hidden?: boolean | null } | null>
  /** By Project folder, then Map id: a default value or null drops that preference, a null entry every one of them. */
  maps?: Record<string, Record<string, { view?: MapPanelView | null; hideClosed?: boolean | null; folded?: string[] | null } | null>>
  /** Replaces every saved tab. */
  tabs?: SavedTab[]
  /** Replaces every Shortcut, in order; those the Shortcut form would refuse are left out. */
  shortcuts?: Shortcut[]
  /** Replaces the open Web tabs; ids naming no Web shortcut are left out. */
  webTabs?: string[]
  /** Replaces the configuration; null, or one missing a field, forgets it. */
  backlog?: BacklogConfig | null
  /** Replaces every Work item action, in order; those the form would refuse, and blank ones, are left out. */
  workItemActions?: WorkItemAction[]
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

/** Where a Session's `claude` process is: none (past), in a ClaudeForge terminal (Hosted) or outside ClaudeForge (External). */
export type SessionState = 'past' | 'hosted' | 'external'

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
  /** The Session host's id for the Hosted session it runs in; null unless it is Hosted. */
  hostedId: string | null
  /** Hidden by the user: the explorer lists it only when asked to show hidden Sessions. */
  hidden: boolean
  /** Its folder (`cwd`) is no longer there, a removed worktree say: it cannot be resumed or forked. */
  folderMissing: boolean
  /** What the Session works on, when its latest `/wayfinder` invocation names one of its Project's Maps. */
  wayfinder: WayfinderLink | null
}

/**
 * What came of asking to delete a Session: only a past one can be, so nothing running is ever lost.
 * `failed` when Windows refused to move one of its files (one held open), leaving it in the catalog.
 */
export type SessionDeletion =
  | { deleted: true }
  | { deleted: false; reason: Exclude<SessionState, 'past'> | 'unknown' | 'failed' }

/**
 * ClaudeForge found its list of Session ids unreadable, so it started a new, empty one. `file` is
 * where the unreadable list now is: set aside beside the new one, or, when it could not be moved,
 * still in place, and then nothing is recorded to disk until ClaudeForge restarts.
 */
export interface SessionListProblem {
  file: string
  setAside: boolean
}

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

/** How a new Hosted session starts. */
export interface SessionStartOptions {
  /**
   * Text Claude Code types in its prompt once the prompt is ready, without sending it
   * (`--prefill`): the user checks it, then presses Enter. Refused with a `"`, `%` or line break
   * when `claude` is a batch file, as cmd.exe, which runs it, would change it.
   */
  prefill?: string
}

const FOLDER_MISSING = /This folder no longer exists: (.+)$/

/** The error the Session host refuses a start with when its folder is no longer there; it names the folder. */
export const folderMissingError = (folder: string): Error => new Error(`This folder no longer exists: ${folder}`)

/**
 * The folder a refused start names as no longer there; null for any other failure. An error
 * crosses IPC as its message only, wrapped in Electron's own words, so the message is searched.
 */
export const missingFolderOf = (failure: unknown): string | null =>
  FOLDER_MISSING.exec(failure instanceof Error ? failure.message : String(failure))?.[1] ?? null

/** A Hosted session as the Session host started it. */
export interface HostedSession {
  /** ClaudeForge's id for the Hosted session, not Claude Code's session id. */
  id: string
  /** Claude Code's id for the Session it runs: the resumed one's, else the new one's (a fork's too). */
  sessionId: string
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
  /** Plugins only: how `claude plugin` names it and where it is installed. */
  install?: InstalledPlugin
  /** MCP servers only: false for those `claude mcp remove` cannot remove, a plugin's or a claude.ai connector. */
  removable?: boolean
  /** The user's and the Project's own skills and subagents only: the Markdown file the editor opens. */
  file?: string
}

/**
 * Where Claude Code's CLI keeps a plugin or MCP server: the user's (global); the Project's, shared
 * through its repository; or the user's own in the Project (local).
 */
export type ClaudeScope = 'user' | 'project' | 'local'

/** An installed plugin, as `claude plugin enable|disable|uninstall` takes it. */
export interface InstalledPlugin {
  /** `<plugin>@<marketplace>`. */
  id: string
  scope: ClaudeScope
}

/** Every Extension a new Session in a Project gets, global and Project-scoped. */
export interface ExtensionListing {
  /** By kind, then name. */
  extensions: Extension[]
  /** Set when `claude` could not list MCP servers or plugins; the listing then lacks them. */
  problem?: 'claude-failed'
  /**
   * The Hosted sessions, in any Project, still running with the setup from before a change
   * ClaudeForge made to their Extensions: Claude Code reads it only when it starts.
   */
  outdatedSessions: string[]
}

/** A plugin a configured marketplace offers. */
export interface AvailablePlugin {
  /** `<plugin>@<marketplace>`. */
  id: string
  name: string
  description: string | null
  marketplace: string
}

/** The plugins `claude plugin install` could install here. */
export interface AvailablePluginListing {
  /** Not installed for the user nor for the Project yet; the most installed first. */
  plugins: AvailablePlugin[]
  /** Set when `claude` could not list them; `plugins` is then empty. */
  problem?: 'claude-failed'
}

/**
 * A change to the Extensions, made through `claude plugin …` or `claude mcp …` (ADR 0003). What
 * ClaudeForge adds for the Project is the user's own there (Claude Code's local scope), so it never
 * adds to the setup the Project shares; switching or removing what the Project shares changes it.
 */
export type ExtensionChange =
  | { action: 'enable-plugin' | 'disable-plugin' | 'uninstall-plugin'; plugin: InstalledPlugin }
  /** `plugin` is an AvailablePlugin's id. */
  | { action: 'install-plugin'; plugin: string; scope: ExtensionScope }
  | { action: 'add-mcp-server'; server: NewMcpServer; scope: ExtensionScope }
  /** From the Project, a server the user added there, else one its `.mcp.json` shares. */
  | { action: 'remove-mcp-server'; name: string; scope: ExtensionScope }

/** How Claude Code reaches an MCP server: a command it runs (stdio), or a URL. */
export type McpTransport = 'stdio' | 'http' | 'sse'

/** An MCP server as `claude mcp add` takes it. */
export interface NewMcpServer {
  name: string
  /** stdio runs a command; http and sse reach a URL. */
  transport: McpTransport
  /** The command (stdio) or the URL. */
  target: string
  /** The command's arguments (stdio). */
  args: string[]
  /** `KEY=value` variables the command runs with (stdio). */
  env: string[]
  /** `Name: value` headers sent to the URL (http, sse). */
  headers: string[]
}

/** What came of a change: Claude Code's own words when it refused or failed. */
export type ExtensionChangeResult = { ok: true } | { ok: false; error: string }

/** The Extensions that are plain Markdown files, which ClaudeForge creates and edits itself (ADR 0003). */
export type ExtensionFileKind = Extract<ExtensionKind, 'skill' | 'subagent'>

/**
 * A skill or subagent to create from ClaudeForge's template: a skill as `skills/<name>/SKILL.md`, a
 * subagent as `agents/<name>.md`, in the Claude Code home (global) or the Project's `.claude/`.
 */
export interface NewExtensionFile {
  kind: ExtensionFileKind
  /** Lowercase letters, numbers and hyphens, 64 at most, as Claude Code names skills and subagents. */
  name: string
  scope: ExtensionScope
}

/** What came of creating a file: refused for a name Claude Code would not take, or one already taken there. */
export type ExtensionFileCreation = { ok: true; file: string } | { ok: false; problem: 'bad-name' | 'exists' }

/** A skill's or subagent's file, as the editor opens it. */
export interface ExtensionFile {
  file: string
  kind: ExtensionFileKind
  scope: ExtensionScope
  text: string
}

/**
 * Why Claude Code would not read a skill's or subagent's frontmatter as meant, by the rules its
 * documentation gives; `line` counts from the file's first line, 1.
 */
export type FrontmatterProblem =
  /** A subagent's file does not open with a block of fields between two `---` lines (a skill needs none). */
  | { code: 'no-frontmatter' }
  /** The `---` line opening the file has no second one ending the fields. */
  | { code: 'unclosed-frontmatter' }
  /** The yaml parser's words, without the position. */
  | { code: 'not-yaml'; line: number; detail: string }
  /** The block is YAML, but not `field: value` pairs. */
  | { code: 'not-fields' }
  /** A subagent's `name` or `description`; a skill requires neither. */
  | { code: 'missing'; field: string }
  | { code: 'not-text'; field: string }
  /**
   * A skill's `name` holds `<`, `>`, a control or invisible character, or a blank other than one
   * space between words; a subagent's starts with `-` or holds `:`.
   */
  | { code: 'bad-name' }
  | { code: 'too-long'; field: string; max: number }

/** What came of saving: nothing is written while the frontmatter has problems. */
export type ExtensionFileSave = { ok: true } | { ok: false; problems: FrontmatterProblem[] }

/**
 * What a Hosted session's `claude` is doing: idle at its prompt, working through a turn, waiting for
 * the user mid-turn (a permission prompt or a question), or done: its last turn is over, until
 * Claude Code says it is back at rest or starts another turn.
 */
export type HostedSessionStatus = 'idle' | 'working' | 'waiting' | 'done'

/** A Windows notification about one Hosted session, worded by the interface. */
export interface WindowNotification {
  /** Names what the notification is about, so the interface knows what to show when the user clicks it. */
  tag: string
  title: string
  body: string
}

/**
 * Where ClaudeForge's own update stands. An installed ClaudeForge looks for a newer release on
 * GitHub releases when it starts and every few hours, and downloads it in the background; the
 * downloaded version installs once the user closes ClaudeForge.
 */
export type UpdateStatus =
  /** Nothing newer downloaded yet, or a build that does not update itself (development, tests). */
  | { state: 'current' }
  /** A newer version is downloaded and installs when ClaudeForge closes. */
  | { state: 'ready'; version: string }

export interface BackendApi {
  sessionHost: {
    /** Asks the user for a Project folder ("Open folder"); null when they cancel. */
    chooseProject(): Promise<string | null>
    /**
     * Starts `claude` in a Project, as a new Session with an id ClaudeForge picks (`--session-id`);
     * its output, status and exit arrive as events. Like resume and fork, refused with
     * `folderMissingError` when the folder is no longer there.
     */
    start(project: string, size: TerminalSize, options?: SessionStartOptions): Promise<HostedSession>
    /**
     * Continues a past Session (`claude --resume <id>`) in the folder it ran in; refused for an
     * unknown Session or one whose `claude` still runs outside ClaudeForge.
     */
    resume(sessionId: string, size: TerminalSize): Promise<HostedSession>
    /** Like resume, but into a new Session (`--fork-session`), leaving the original as it was. */
    fork(sessionId: string, size: TerminalSize): Promise<HostedSession>
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
    /**
     * Names the Project whose Maps the interface displays, and whether its Map is on show (the Map
     * panel expanded). From then on `map.changed` is pushed for that Project: as soon as a local
     * markdown Map's files change; for GitHub, when a turn ends in one of its Sessions, when the user
     * returns to the window, and about every minute while the Map is on show in a visible window.
     */
    watch(project: string, shown: boolean): Promise<void>
    /** The user asked for the Project's Maps to be read again now: pushes `map.changed` for it. */
    refresh(project: string): Promise<void>
    /**
     * Opens a Map's or Ticket's issue where its Tracker keeps it (its `path`): a web address in the
     * browser, a markdown file in its default app; refused for anything else.
     */
    openIssue(path: string): Promise<void>
  }
  extensions: {
    /** Lists the Extensions of a Project, through Claude Code's CLI for MCP servers and plugins. */
    list(project: string): Promise<ExtensionListing>
    /** The marketplaces' plugins that could be installed for the user or the Project. */
    available(project: string): Promise<AvailablePluginListing>
    /** Makes one change through Claude Code's CLI, run in the Project's folder. */
    change(project: string, change: ExtensionChange): Promise<ExtensionChangeResult>
    /** Writes a new skill or subagent from ClaudeForge's template, for the user or in the Project. */
    create(project: string, file: NewExtensionFile): Promise<ExtensionFileCreation>
    /**
     * Reads a skill's or subagent's file: one in the `skills/` or `agents/` of the Claude Code home
     * or of the Project's `.claude/`; refused for any other.
     */
    read(project: string, file: string): Promise<ExtensionFile>
    /** Writes a file `read` would open, once its frontmatter is valid, keeping its line endings. */
    save(project: string, file: string, text: string): Promise<ExtensionFileSave>
  }
  appState: {
    /** The state; the first read drops the saved tabs whose Session's folder is gone, as they cannot resume. */
    read(): Promise<AppState>
    write(patch: AppStatePatch): Promise<AppState>
  }
  sessions: {
    /**
     * Every Session, grouped by Project, the most recently active Project first: only the
     * conversations that ran in a ClaudeForge terminal, by its list of Session ids (ADR 0005).
     */
    list(): Promise<ProjectSessions[]>
    /** Why the list of Session ids was found unreadable as ClaudeForge started; null when it was fine. */
    listProblem(): Promise<SessionListProblem | null>
    /** Names the Session in ClaudeForge only; an empty title gives it back Claude Code's name. */
    rename(id: string, title: string): Promise<void>
    /** Hides the Session from the explorer's list, or shows it again. */
    setHidden(id: string, hidden: boolean): Promise<void>
    /**
     * Moves each past Session's history files to the Windows Recycle Bin; refused for any other.
     * Each Session goes on its own, so one that fails does not stop the others. By id.
     */
    delete(ids: string[]): Promise<Record<string, SessionDeletion>>
  }
  system: {
    info(): Promise<SystemInfo>
  }
  backlog: BacklogApi
  web: {
    /** Opens a Web tab's address in the default browser; refused for anything but an http or https address or a local `.html` file. */
    openInBrowser(address: string): Promise<void>
  }
  updates: {
    /** Whether a newer ClaudeForge is downloaded, waiting to install when ClaudeForge closes. */
    status(): Promise<UpdateStatus>
  }
  claudeCode: {
    /** Looks for `claude` (at the path the user chose, then on PATH) and checks its version. */
    locate(): Promise<ClaudeCodeStatus>
    /** Lets the user pick `claude.exe` in a file dialog, remembers it in app state, then locates again. */
    choose(): Promise<ClaudeCodeStatus>
  }
  /**
   * The Elements of the interface, as the user asks for them by hand: the same contract a Hosted
   * session's Claude goes through with the ClaudeForge CLI (ADR 0007), there in that Session's name.
   */
  elements: {
    request<Op extends ElementOp>(request: Extract<ElementRequest, { op: Op }>): Promise<ElementResult<Op>>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    /**
     * Asks to close the window, as its close button and Alt+F4 do. With a Hosted session working or
     * an editor tab unsaved, the interface is asked to warn the user first (`window.closeRequested`);
     * otherwise every Hosted session's `claude` is stopped, and once all have ended, the window closes.
     */
    close(): Promise<void>
    /** Closes the window even with Hosted sessions working or editors unsaved, once the user agreed, stopping them as close does. */
    closeAnyway(): Promise<void>
    /**
     * Tells the backend which editor tabs (by key) hold unsaved text, replacing what it was told
     * before, so that closing the window warns about them. The interface keeps it current.
     */
    setUnsavedEditors(keys: string[]): Promise<void>
    isMaximized(): Promise<boolean>
    /** Raises a Windows notification; clicking it brings the window to the front, then pushes its tag. */
    notify(notification: WindowNotification): Promise<void>
  }
}

export interface BackendEvents {
  /** What a Hosted session's terminal printed. */
  'sessionHost.output': { id: string; data: string }
  /** A Hosted session's `claude` ended. */
  'sessionHost.exit': { id: string; exitCode: number }
  /** A Hosted session's status changed; every Hosted session starts idle. */
  'sessionHost.status': { id: string; status: HostedSessionStatus }
  /**
   * A Hosted session's turn ended, finished or interrupted: what Claude did may have changed its
   * Project. `cwd` is the folder it runs in: its Project, or a git worktree of it.
   */
  'sessionHost.turnEnded': { id: string; cwd: string }
  'appState.changed': AppState
  /** The whole Session catalog, after Claude Code's files changed it. */
  'sessions.changed': ProjectSessions[]
  'window.maximizedChanged': { maximized: boolean }
  /** The user clicked a notification, which brought the window to the front. */
  'window.notificationClicked': { tag: string }
  /**
   * The user asked to close the window while Hosted sessions work (by id) or editor tabs hold
   * unsaved text (by key, as `window.setUnsavedEditors` gave them): `window.closeAnyway` closes it.
   */
  'window.closeRequested': { working: string[]; unsavedEditors: string[] }
  /** The watched Project's Maps may have changed (`map.watch`): list them and load the shown one again. */
  'map.changed': { project: string }
  /** ClaudeForge's own update moved on: a newer version is downloaded. */
  'updates.changed': UpdateStatus
  /**
   * Elements changed, by a request or as a file Content item's file did: a Project's Created Elements,
   * or ClaudeForge's own when `project` is null. List them again.
   */
  'elements.changed': { project: string | null }
}

export type EventName = keyof BackendEvents

// A record, so adding an event to BackendEvents without listing it here fails to compile.
const EVENTS: Record<EventName, true> = {
  'sessionHost.output': true,
  'sessionHost.exit': true,
  'sessionHost.status': true,
  'sessionHost.turnEnded': true,
  'appState.changed': true,
  'sessions.changed': true,
  'window.maximizedChanged': true,
  'window.notificationClicked': true,
  'window.closeRequested': true,
  'map.changed': true,
  'updates.changed': true,
  'elements.changed': true
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
