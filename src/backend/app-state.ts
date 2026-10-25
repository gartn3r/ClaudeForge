import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PANEL_BOUNDS,
  clampPanelWidth,
  type AppState,
  type AppStatePatch,
  type PanelId,
  type PanelLayout,
  type SessionPreferences
} from '../shared/api'

export const STATE_FILE = 'state.json'

/** The longest name the user can give a Session, as long as the titles Claude Code's history yields. */
export const SESSION_TITLE_MAX_LENGTH = 200

export function defaultAppState(): AppState {
  return {
    version: 1,
    layout: {
      explorer: { width: PANEL_BOUNDS.explorer.default, collapsed: false },
      map: { width: PANEL_BOUNDS.map.default, collapsed: false }
    },
    claudePath: null,
    sessions: {}
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

/** Applies a patch to a state, ignoring unknown or malformed fields and clamping widths. */
export function applyPatch(state: AppState, patch: AppStatePatch | unknown): AppState {
  const { layout, claudePath, sessions } = (patch ?? {}) as AppStatePatch
  let next = state
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
  if (typeof sessions === 'object' && sessions !== null) {
    next = { ...next, sessions: mergeSessions(state.sessions, sessions) }
  }
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
