// Keeps the displayed Project's Maps fresh while Claude works: tells the
// interface when they may have changed, so it lists and loads them again.
// Local markdown Maps change on disk and are watched; a GitHub Map is asked
// for again at moments chosen to spare the user's API quota.

import { watch as watchFolder, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { Tracker } from '../../shared/api'
import { pathKey, placeFolder } from '../worktree'
import { detectTracker } from './tracker'

/** How often a GitHub Map on show is read again, when nothing else asked for it meanwhile. */
export const GITHUB_REFRESH_INTERVAL_MS = 60_000

/** Coming back to the window this soon after the last refresh reads nothing again. */
export const FOCUS_REFRESH_GAP_MS = 10_000

/** Wayfinder writes several files in a row: one push once they settle. */
const FILES_SETTLE_MS = 100

/** Wayfinder's own folder for local markdown Maps, directly in the Project. */
const SCRATCH = '.scratch'

interface Watched {
  project: string
  /** The Map panel is expanded, so its Map is on show. */
  shown: boolean
  tracker: Tracker
}

export interface MapRefreshOptions {
  /** Pushes that the Project's Maps may have changed. */
  onChange(project: string): void
  /** Whether the window is on screen when the refresh starts. */
  visible: boolean
}

/** The refresh policy of the Map service, for the one Project whose Maps the interface displays. */
export class MapRefresh {
  private watched: Watched | null = null
  /** The Project's folder, for `.scratch` coming and going. */
  private projectFolder: FSWatcher | null = null
  /** `.scratch` and everything in it. */
  private scratchFolder: FSWatcher | null = null
  private settling: NodeJS.Timeout | undefined
  private polling: NodeJS.Timeout | undefined
  private visible: boolean
  /** When a change was last pushed, in ms since the epoch. */
  private pushedAt = 0
  /** Counts the calls to watch, so a Tracker detection that a newer call overtook is dropped. */
  private generation = 0
  private disposed = false

  constructor(private readonly options: MapRefreshOptions) {
    this.visible = options.visible
  }

  /** Follows another Project, or the same one with its Map shown or hidden; its Tracker is read again. */
  async watch(project: string, shown: boolean): Promise<void> {
    const generation = ++this.generation
    const tracker = await detectTracker(project)
    if (generation !== this.generation || this.disposed) return
    if (this.isWatched(project) && this.watched!.tracker.kind === tracker.kind) {
      this.watched = { project, shown, tracker }
      this.schedulePolling()
      return
    }
    this.stop()
    this.watched = { project, shown, tracker }
    if (tracker.kind === 'local-markdown') this.watchFiles(project)
    this.schedulePolling()
  }

  /** The user asked for the Project's Maps again, perhaps after changing its Tracker declaration. */
  async refresh(project: string): Promise<void> {
    if (!this.isWatched(project)) return this.options.onChange(project)
    await this.watch(project, this.watched!.shown)
    this.pushChange()
  }

  /** A turn ended in a Hosted session running in `cwd`: Claude may have changed a GitHub Map of its Project. */
  async turnEnded(cwd: string): Promise<void> {
    const watched = this.watched
    if (watched?.tracker.kind !== 'github') return
    const { project } = await placeFolder(cwd)
    if (this.watched === watched && this.isWatched(project)) this.pushChange()
  }

  /** The user came back to the window: a GitHub Map on show is read again, unless it just was. */
  focused(): void {
    const watched = this.watched
    if (watched?.tracker.kind !== 'github' || !watched.shown) return
    if (Date.now() - this.pushedAt >= FOCUS_REFRESH_GAP_MS) this.pushChange()
  }

  /** The window was minimized, hidden, restored or shown. */
  visibilityChanged(visible: boolean): void {
    this.visible = visible
    this.schedulePolling()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.watched = null
  }

  private isWatched(project: string): boolean {
    return !!this.watched && pathKey(this.watched.project) === pathKey(project)
  }

  private pushChange(): void {
    if (!this.watched) return
    this.pushedAt = Date.now()
    this.options.onChange(this.watched.project)
    // Whatever asked, the next timed refresh is a full interval away.
    this.schedulePolling()
  }

  /** Reads a GitHub Map again about every minute, only while it is on show in a visible window. */
  private schedulePolling(): void {
    this.stopPolling()
    const watched = this.watched
    if (watched?.tracker.kind !== 'github' || !watched.shown || !this.visible) return
    this.polling = setInterval(() => this.pushChange(), GITHUB_REFRESH_INTERVAL_MS)
  }

  private stopPolling(): void {
    clearInterval(this.polling)
    this.polling = undefined
  }

  /** Pushes once a burst of file changes settles. */
  private filesChanged(): void {
    clearTimeout(this.settling)
    this.settling = setTimeout(() => this.pushChange(), FILES_SETTLE_MS)
  }

  /**
   * Watches `.scratch` alone, not the whole Project (its `.git`, its `node_modules`), and the
   * Project's folder itself for `.scratch` being created, removed or replaced.
   */
  private watchFiles(project: string): void {
    this.projectFolder = this.watchOrNull(project, false, (filename) => {
      if (filename !== null && filename.toLowerCase() !== SCRATCH) return
      this.watchScratch(project)
      this.filesChanged()
    })
    this.watchScratch(project)
  }

  private watchScratch(project: string): void {
    this.scratchFolder?.close()
    this.scratchFolder = this.watchOrNull(join(project, SCRATCH), true, () => this.filesChanged())
  }

  /** A watcher of a folder, or null when the folder is not there (a Project with no Map yet). */
  private watchOrNull(folder: string, recursive: boolean, listener: (filename: string | null) => void): FSWatcher | null {
    try {
      const watcher = watchFolder(folder, { recursive }, (_event, filename) => listener(filename))
      // The folder went away: nothing is left to watch in it.
      watcher.on('error', () => watcher.close())
      return watcher
    } catch {
      return null
    }
  }

  private stop(): void {
    clearTimeout(this.settling)
    this.projectFolder?.close()
    this.scratchFolder?.close()
    this.projectFolder = this.scratchFolder = null
    this.stopPolling()
  }
}
