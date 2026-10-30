import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PANEL_BOUNDS,
  clampPanelWidth,
  tidyAppTitle,
  type AppState,
  type AppStatePatch,
  type BacklogConfig,
  type MapPreferences,
  type ProjectMapPreferences,
  type PanelId,
  type PanelLayout,
  type SavedTab,
  type SessionPreferences,
  type Shortcut,
  type WorkItemAction
} from '../shared/api'
import { shortcutProblems, tidyShortcut } from '../shared/shortcuts'
import { backlogConfigured, tidyBacklogConfig, tidyWorkItemActions } from '../shared/work-items'

export const STATE_FILE = 'state.json'

/** The longest name the user can give a Session, as long as the titles Claude Code's history yields. */
export const SESSION_TITLE_MAX_LENGTH = 200

export function defaultAppState(): AppState {
  return {
    version: 1,
    appTitle: null,
    layout: {
      explorer: { width: PANEL_BOUNDS.explorer.default, collapsed: false },
      map: { width: PANEL_BOUNDS.map.default, collapsed: false }
    },
    claudePath: null,
    gpuRendering: true,
    notifications: true,
    sessions: {},
    maps: {},
    tabs: [],
    shortcuts: [],
    webTabs: [],
    backlog: null,
    workItemActions: []
  }
}

function clampWidth(panel: PanelId, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return clampPanelWidth(panel, value)
}

function mergePanel(panel: PanelId, base: PanelLayout, patch: unknown): PanelLayout {
  if (typeof patch !== 'object' || patch === null) return base
  const { width, collapsed } = patch as Partial<PanelLayout>
  return {
    width: width === undefined ? base.width : clampWidth(panel, width, base.width),
    collapsed: typeof collapsed === 'boolean' ? collapsed : base.collapsed
  }
}

/** One Session's preferences with a patch applied; undefined once none is left. */
function mergeSession(base: SessionPreferences | undefined, patch: unknown): SessionPreferences | undefined {
  if (patch === null) return undefined
  if (typeof patch !== 'object') return base
  const { title, hidden } = patch as Record<string, unknown>
  const next: SessionPreferences = { ...base }
  if (typeof title === 'string' && title.trim()) next.title = title.trim().slice(0, SESSION_TITLE_MAX_LENGTH)
  else if (title !== undefined) delete next.title
  if (hidden === true) next.hidden = true
  else if (hidden !== undefined) delete next.hidden
  return Object.keys(next).length ? next : undefined
}

function mergeSessions(
  base: Record<string, SessionPreferences>,
  patch: Record<string, unknown>
): Record<string, SessionPreferences> {
  const next = { ...base }
  for (const [id, entry] of Object.entries(patch)) {
    const merged = mergeSession(next[id], entry)
    if (merged) next[id] = merged
    else delete next[id]
  }
  return next
}

/** One Map's preferences with a patch applied; undefined once none is left. */
function mergeMap(base: MapPreferences | undefined, patch: unknown): MapPreferences | undefined {
  if (patch === null) return undefined
  if (typeof patch !== 'object') return base
  const { view, hideClosed, folded } = patch as Record<string, unknown>
  const next: MapPreferences = { ...base }
  if (view === 'tree') next.view = 'tree'
  else if (view === 'graph' || view === null) delete next.view
  if (hideClosed === true) next.hideClosed = true
  else if (hideClosed === false || hideClosed === null) delete next.hideClosed
  if (Array.isArray(folded)) {
    const ids = [...new Set(folded.filter((id): id is string => typeof id === 'string'))]
    if (ids.length) next.folded = ids
    else delete next.folded
  } else if (folded === null) delete next.folded
  return Object.keys(next).length ? next : undefined
}

function mergeMaps(
  base: Record<string, ProjectMapPreferences>,
  patch: Record<string, unknown>
): Record<string, ProjectMapPreferences> {
  const next = { ...base }
  for (const [project, maps] of Object.entries(patch)) {
    if (typeof maps !== 'object' || maps === null) continue
    const projectMaps = { ...next[project] }
    for (const [mapId, entry] of Object.entries(maps)) {
      const merged = mergeMap(projectMaps[mapId], entry)
      if (merged) projectMaps[mapId] = merged
      else delete projectMaps[mapId]
    }
    if (Object.keys(projectMaps).length) next[project] = projectMaps
    else delete next[project]
  }
  return next
}

/** The well-formed saved tabs of a patch, in order. */
function savedTabs(tabs: unknown[]): SavedTab[] {
  return tabs.flatMap((tab) => {
    if (typeof tab !== 'object' || tab === null) return []
    const { sessionId, project, title } = tab as Record<string, unknown>
    if (typeof sessionId !== 'string' || !sessionId || typeof project !== 'string' || !project) return []
    return [{ sessionId, project, title: typeof title === 'string' && title ? title : null }]
  })
}

const isText = (value: unknown): value is string => typeof value === 'string'

/** A Shortcut read from a patch, with the fields of its kind; null when it has not got them. */
function readShortcut(entry: unknown): Shortcut | null {
  if (typeof entry !== 'object' || entry === null) return null
  const { id, name, kind, address, command } = entry as Record<string, unknown>
  if (!isText(id) || !id || !isText(name)) return null
  if (kind === 'web') return isText(address) ? { id, name, kind, address } : null
  if (kind !== 'skill' || typeof command !== 'object' || command === null) return null
  const { mode, skill, args, text } = command as Record<string, unknown>
  if (mode === 'skill' && isText(skill) && isText(args)) return { id, name, kind, command: { mode, skill, args } }
  if (mode === 'free' && isText(text)) return { id, name, kind, command: { mode, text } }
  return null
}

/** The Shortcuts of a patch, in order: those the Shortcut form would refuse, or whose id is taken, are left out. */
function savedShortcuts(entries: unknown[]): Shortcut[] {
  const ids = new Set<string>()
  return entries.flatMap((entry) => {
    const shortcut = readShortcut(entry)
    if (!shortcut || ids.has(shortcut.id) || shortcutProblems(shortcut).length) return []
    ids.add(shortcut.id)
    return [tidyShortcut(shortcut)]
  })
}

/** The open Web tabs, in order: each names a Web shortcut, once. */
function openWebTabs(ids: unknown[], shortcuts: Shortcut[]): string[] {
  const web = new Set(shortcuts.filter((shortcut) => shortcut.kind === 'web').map((shortcut) => shortcut.id))
  return [...new Set(ids.filter((id): id is string => isText(id) && web.has(id)))]
}

/** The configuration of a patch, tidied; null when a field is missing or not text. */
function savedBacklog(entry: object): BacklogConfig | null {
  const { organization, project, areaPath, iterationRoot } = entry as Record<string, unknown>
  if (![organization, project, areaPath, iterationRoot].every(isText)) return null
  const config = tidyBacklogConfig({ organization, project, areaPath, iterationRoot } as BacklogConfig)
  return backlogConfigured(config) ? config : null
}

/** The Work item actions of a patch, those with every field as text, as the app state keeps them. */
function savedActions(entries: unknown[]): WorkItemAction[] {
  const actions = entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { id, label, skill, text, colour } = entry as Record<string, unknown>
    return [id, label, skill, text, colour].every(isText) ? [{ id, label, skill, text, colour } as WorkItemAction] : []
  })
  return tidyWorkItemActions(actions)
}

/** Applies a patch to a state, ignoring unknown or malformed fields and clamping widths. */
export function applyPatch(state: AppState, patch: AppStatePatch | unknown): AppState {
  const { appTitle, layout, claudePath, gpuRendering, notifications, sessions, maps, tabs, shortcuts, webTabs, backlog, workItemActions } =
    (patch ?? {}) as AppStatePatch
  let next = state
  if (typeof appTitle === 'string') next = { ...next, appTitle: tidyAppTitle(appTitle) }
  else if (appTitle === null) next = { ...next, appTitle }
  if (typeof layout === 'object' && layout !== null) {
    next = {
      ...next,
      layout: {
        explorer: mergePanel('explorer', state.layout.explorer, layout.explorer),
        map: mergePanel('map', state.layout.map, layout.map)
      }
    }
  }
  if (typeof claudePath === 'string' || claudePath === null) next = { ...next, claudePath }
  if (typeof gpuRendering === 'boolean') next = { ...next, gpuRendering }
  if (typeof notifications === 'boolean') next = { ...next, notifications }
  if (typeof sessions === 'object' && sessions !== null) {
    next = { ...next, sessions: mergeSessions(state.sessions, sessions) }
  }
  if (typeof maps === 'object' && maps !== null) next = { ...next, maps: mergeMaps(state.maps, maps) }
  if (Array.isArray(tabs)) next = { ...next, tabs: savedTabs(tabs) }
  // A Web tab closes with its Shortcut, or once the Shortcut is no longer a Web shortcut.
  if (Array.isArray(shortcuts)) next = { ...next, shortcuts: savedShortcuts(shortcuts) }
  if (Array.isArray(webTabs) || Array.isArray(shortcuts)) {
    next = { ...next, webTabs: openWebTabs(Array.isArray(webTabs) ? webTabs : next.webTabs, next.shortcuts) }
  }
  if (backlog === null) next = { ...next, backlog }
  else if (typeof backlog === 'object') next = { ...next, backlog: savedBacklog(backlog) }
  if (Array.isArray(workItemActions)) next = { ...next, workItemActions: savedActions(workItemActions) }
  return next
}

/**
 * App state persisted as one JSON file in ClaudeForge's own data folder
 * (never under the Claude Code home). Writes are serialised and atomic.
 */
export class AppStateStore {
  private readonly file: string
  private state: AppState | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {
    this.file = join(dir, STATE_FILE)
  }

  async read(): Promise<AppState> {
    if (!this.state) this.state = await this.load()
    return this.state
  }

  write(patch: AppStatePatch): Promise<AppState> {
    const next = this.queue.then(async () => {
      const state = applyPatch(await this.read(), patch)
      await this.save(state)
      this.state = state
      return state
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private async load(): Promise<AppState> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      return defaultAppState()
    }
    try {
      return applyPatch(defaultAppState(), JSON.parse(raw))
    } catch {
      // A corrupt file falls back to the defaults; the next write replaces it.
      return defaultAppState()
    }
  }

  private async save(state: AppState): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
    await rename(tmp, this.file)
  }
}
