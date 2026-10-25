import { watch, type FSWatcher, type Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { ProjectSessions, SessionDeletion, SessionPreferences, SessionSummary } from '../shared/api'
import { readLiveSessions, type LiveSession } from './live-sessions'
import type { TrashItem } from './recycle-bin'
import { readHistory, type HistorySummary } from './session-history'
import { placeFolder, type FolderPlace } from './worktree'

/** How long to let a burst of file changes settle before re-reading. */
const SETTLE_MS = 150
/**
 * How often to look again without being told: a `claude` that crashes leaves its
 * registry entry behind, and no file changes when its process dies.
 */
const RECHECK_MS = 2_000

/** A Session and the path of the Project it belongs to. */
interface PlacedSession {
  project: string
  session: SessionSummary
}

interface CachedHistory {
  size: number
  mtimeMs: number
  summary: HistorySummary
}

/** Windows paths compare without regard to case. */
const pathKey = (path: string): string => {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * The Session catalog: every Session in Claude Code's history
 * (`<claude home>/projects/<folder>/<session-id>.jsonl`) and live-session registry
 * (`<claude home>/sessions/<pid>.json`), grouped by Project.
 */
export class SessionCatalog {
  private readonly histories = new Map<string, CachedHistory>()
  /** Which Project each folder belongs to; a folder's git link does not change. */
  private readonly places = new Map<string, Promise<FolderPlace>>()

  private readonly watchers = new Map<string, FSWatcher>()
  private recheck: NodeJS.Timeout | undefined
  private settle: NodeJS.Timeout | undefined
  private reading: Promise<ProjectSessions[]> | undefined
  /** The catalog last returned or pushed, as JSON, so only real changes are pushed. */
  private lastSeen: string | undefined
  private disposed = false

  /**
   * Calls back with the whole catalog whenever Claude Code's files change it, once watching.
   * `preferences` reads how the user tidied each Session in ClaudeForge, by Session id.
   */
  constructor(
    private readonly claudeHome: string,
    private readonly onChange: (projects: ProjectSessions[]) => void,
    private readonly preferences: () => Promise<Record<string, SessionPreferences>>
  ) {}

  /** The catalog as it is now. The first call starts watching Claude Code's files. */
  async list(): Promise<ProjectSessions[]> {
    if (!this.recheck && !this.disposed) {
      this.watch()
      this.recheck = setInterval(() => this.refresh(), RECHECK_MS)
    }
    const projects = await this.read()
    this.lastSeen = JSON.stringify(projects)
    return projects
  }

  /**
   * Moves a past Session's history to the Recycle Bin: its `<id>.jsonl` in every folder it ran in,
   * with the `<id>` folder of subagent transcripts beside each. The Session's state is read afresh,
   * so one that started running since the interface last listed it is refused.
   */
  async delete(id: string, trashItem: TrashItem): Promise<SessionDeletion> {
    const session = (await this.read()).flatMap((project) => project.sessions).find((s) => s.id === id)
    if (!session) return { deleted: false, reason: 'unknown' }
    if (session.state !== 'past') return { deleted: false, reason: session.state }
    const root = join(this.claudeHome, 'projects')
    for (const folder of await entriesOf(root)) {
      for (const name of await entriesOf(join(root, folder))) {
        if (name === `${id}.jsonl` || name === id) await trashItem(join(root, folder, name))
      }
    }
    return { deleted: true }
  }

  dispose(): void {
    this.disposed = true
    clearInterval(this.recheck)
    clearTimeout(this.settle)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  /** Watches the history and registry folders, as far as they exist yet. */
  private watch(): void {
    for (const dir of ['projects', 'sessions']) {
      if (this.watchers.has(dir)) continue
      try {
        const watcher = watch(join(this.claudeHome, dir), { recursive: dir === 'projects' }, () => this.settleThenRead())
        watcher.on('error', () => {
          watcher.close()
          this.watchers.delete(dir)
        })
        this.watchers.set(dir, watcher)
      } catch {
        // Not created yet (Claude Code never ran here): the next recheck tries again.
      }
    }
  }

  private settleThenRead(): void {
    clearTimeout(this.settle)
    this.settle = setTimeout(() => this.refresh(), SETTLE_MS)
  }

  /** Reads the catalog again and pushes it if it differs from the last one seen. */
  refresh(): Promise<void> {
    this.watch()
    return (
      this.read()
        .then((projects) => {
          const text = JSON.stringify(projects)
          if (this.disposed || text === this.lastSeen) return
          this.lastSeen = text
          this.onChange(projects)
        })
        // A read that failed midway (a folder vanished) is retried at the next recheck.
        .catch(() => undefined)
    )
  }

  /** One read at a time: a read asked for during another waits for it, then runs. */
  private read(): Promise<ProjectSessions[]> {
    const next = (this.reading ?? Promise.resolve()).catch(() => undefined).then(() => this.readNow())
    this.reading = next
    return next
  }

  private async readNow(): Promise<ProjectSessions[]> {
    const [histories, live, preferences] = await Promise.all([
      this.readHistories(),
      readLiveSessions(this.claudeHome),
      this.preferences()
    ])
    const liveById = new Map(live.map((session) => [session.sessionId, session]))
    const ids = new Set([...histories.keys(), ...liveById.keys()])
    const placed = await Promise.all(
      [...ids].map((id) => this.place(id, histories.get(id), liveById.get(id), preferences[id] ?? {}))
    )
    return group(placed.filter((entry) => entry !== null))
  }

  /** One Session and the Project it belongs to, or null when there is no Session to list. */
  private async place(
    id: string,
    history: HistorySummary | undefined,
    live: LiveSession | undefined,
    preferences: SessionPreferences
  ): Promise<PlacedSession | null> {
    // The running process knows the Session's name first: it writes the history afterwards.
    const claudeTitle = live?.name ?? history?.customTitle ?? history?.aiTitle ?? history?.firstMessage ?? null
    const cwd = history?.cwd ?? live?.cwd
    // A finished history with nothing typed in it holds no Session worth listing.
    if (!cwd || (!live && claudeTitle === null)) return null
    const { project, worktree } = await this.placeOf(cwd)
    // Nothing runs in ClaudeForge yet, so every running Session is External.
    const session: SessionSummary = {
      id,
      // The user's own name for it wins over every name Claude Code gives it.
      title: preferences.title ?? claudeTitle,
      cwd,
      worktree,
      // A running claude reports activity (a status change) before it reaches the history.
      lastActivity: Math.max(history?.lastActivity ?? 0, live?.updatedAt ?? 0),
      state: live ? 'external' : 'past',
      hidden: preferences.hidden ?? false
    }
    return { project, session }
  }

  private placeOf(folder: string): Promise<FolderPlace> {
    const key = pathKey(folder)
    let place = this.places.get(key)
    if (!place) {
      place = placeFolder(folder)
      this.places.set(key, place)
    }
    return place
  }

  /** Every history file's summary by Session id, re-reading only the files that changed. */
  private async readHistories(): Promise<Map<string, HistorySummary>> {
    const root = join(this.claudeHome, 'projects')
    const seen = new Set<string>()
    const byId = new Map<string, HistorySummary>()
    for (const folder of await entriesOf(root)) {
      for (const name of await entriesOf(join(root, folder))) {
        if (!name.endsWith('.jsonl')) continue
        const file = join(root, folder, name)
        const summary = await this.summaryOf(file)
        if (!summary) continue
        seen.add(file)
        const id = basename(name, '.jsonl')
        byId.set(id, mergeHistories(byId.get(id), summary))
      }
    }
    for (const file of this.histories.keys()) if (!seen.has(file)) this.histories.delete(file)
    return byId
  }

  private async summaryOf(file: string): Promise<HistorySummary | null> {
    let stats: Stats
    try {
      stats = await stat(file)
    } catch {
      return null
    }
    const cached = this.histories.get(file)
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return cached.summary
    let summary: HistorySummary
    try {
      summary = await readHistory(file)
    } catch {
      // Deleted or locked between listing and reading: the next refresh sees it as it is.
      return null
    }
    summary.lastActivity ??= stats.mtimeMs
    this.histories.set(file, { size: stats.size, mtimeMs: stats.mtimeMs, summary })
    return summary
  }
}

async function entriesOf(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/**
 * A Session moved between folders (into a worktree, say) has a history file in each:
 * the most recently active one describes it, the other fills in what it lacks.
 */
function mergeHistories(a: HistorySummary | undefined, b: HistorySummary): HistorySummary {
  if (!a) return b
  const [recent, older] = (a.lastActivity ?? 0) >= (b.lastActivity ?? 0) ? [a, b] : [b, a]
  return {
    cwd: recent.cwd ?? older.cwd,
    firstMessage: older.firstMessage ?? recent.firstMessage,
    customTitle: recent.customTitle ?? older.customTitle,
    aiTitle: recent.aiTitle ?? older.aiTitle,
    lastActivity: recent.lastActivity
  }
}

function group(placed: PlacedSession[]): ProjectSessions[] {
  const projects = new Map<string, ProjectSessions>()
  for (const { project: path, session } of placed) {
    const key = pathKey(path)
    let project = projects.get(key)
    if (!project) {
      project = { path, name: basename(path), sessions: [] }
      projects.set(key, project)
    }
    project.sessions.push(session)
  }
  const byActivity = (a: SessionSummary, b: SessionSummary): number => b.lastActivity - a.lastActivity
  for (const project of projects.values()) project.sessions.sort(byActivity)
  return [...projects.values()].sort((a, b) => byActivity(a.sessions[0]!, b.sessions[0]!))
}
