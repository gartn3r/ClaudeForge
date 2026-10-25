import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PANEL_BOUNDS,
  clampPanelWidth,
  type AppState,
  type AppStatePatch,
  type PanelId,
  type PanelLayout
} from '../shared/api'

export const STATE_FILE = 'state.json'

export function defaultAppState(): AppState {
  return {
    version: 1,
    layout: {
      explorer: { width: PANEL_BOUNDS.explorer.default, collapsed: false },
      map: { width: PANEL_BOUNDS.map.default, collapsed: false }
    }
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

/** Applies a patch to a state, ignoring unknown or malformed fields and clamping widths. */
export function applyPatch(state: AppState, patch: AppStatePatch | unknown): AppState {
  const layout = (patch as AppStatePatch | undefined)?.layout
  if (typeof layout !== 'object' || layout === null) return state
  return {
    ...state,
    layout: {
      explorer: mergePanel('explorer', state.layout.explorer, layout.explorer),
      map: mergePanel('map', state.layout.map, layout.map)
    }
  }
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
