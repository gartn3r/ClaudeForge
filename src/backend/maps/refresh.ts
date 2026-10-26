// Keeps the displayed Project's Maps fresh while Claude works: tells the
// interface when they may have changed, so it lists and loads them again.
// Local markdown Maps change on disk and are watched; a GitHub Map is asked
// for again at moments chosen to spare the user's API quota.

import { watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import type { Tracker } from '../../shared/api'
import { placeFolder } from '../worktree'
import { detectTracker } from './tracker'

/** How often a GitHub Map on show is read again, when nothing else asked for it meanwhile. */
export const GITHUB_REFRESH_INTERVAL_MS = 60_000

/** Wayfinder writes several files in a row: one push once they settle. */
const FILES_SETTLE_MS = 100

/** Where local markdown Maps live in a Project, Wayfinder's own folder. */
const SCRATCH = /^\.scratch(?:[\\/]|$)/i

/** Windows paths compare without regard to case. */
const pathKey = (path: string): string => {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

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
  private files: FSWatcher | null = null
  private settling: NodeJS.Timeout | undefined
  private polling: NodeJS.Timeout | undefined
  private visible: boolean
  /** Counts the calls to watch, so a Tracker detection that a newer call overtook is dropped. */
  private generation = 0
  private disposed = false

  constructor(private readonly options: MapRefreshOptions) {
    this.visible = options.visible
  }

  /** Follows another Project, or the same one with its Map shown or hidden. */
  async watch(project: string, shown: boolean): Promise<void> {
    const generation = ++this.generation
    if (this.watched && pathKey(this.watched.project) === pathKey(project)) {
      this.watched.shown = shown
      this.poll()
      return
    }
    const tracker = await detectTracker(project)
    if (generation !== this.generation || this.disposed) return
    this.stop()
    this.watched = { project, shown, tracker }
    if (tracker.kind === 'local-markdown') this.watchFiles(project)
    this.poll()
  }

  /** The user asked for the Project's Maps again. */
  refresh(project: string): void {
    if (this.watched && pathKey(this.watched.project) === pathKey(project)) this.changed()
    else this.options.onChange(project)
  }

  /** A turn ended in a Hosted session running in `cwd`: Claude may have changed a GitHub Map of its Project. */
  async turnEnded(cwd: string): Promise<void> {
    const watched = this.watched
    if (watched?.tracker.kind !== 'github') return
    const { project } = await placeFolder(cwd)
    if (this.watched === watched && pathKey(project) === pathKey(watched.project)) this.changed()
  }

  /** The user came back to the window. */
  focused(): void {
    if (this.watched?.tracker.kind === 'github') this.changed()
  }

  /** The window was minimized, hidden, restored or shown. */
  visibilityChanged(visible: boolean): void {
    this.visible = visible
    this.poll()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.watched = null
  }

  private changed(): void {
    if (!this.watched) return
    this.options.onChange(this.watched.project)
    // Whatever asked, the next timed refresh is a full interval away.
    this.poll()
  }

  /** Reads a GitHub Map again about every minute, only while it is on show in a visible window. */
  private poll(): void {
    clearInterval(this.polling)
    this.polling = undefined
    const watched = this.watched
    if (watched?.tracker.kind !== 'github' || !watched.shown || !this.visible) return
    this.polling = setInterval(() => this.changed(), GITHUB_REFRESH_INTERVAL_MS)
  }

  private watchFiles(project: string): void {
    try {
      this.files = watch(project, { recursive: true }, (_event, filename) => {
        if (filename !== null && !SCRATCH.test(filename)) return
        clearTimeout(this.settling)
        this.settling = setTimeout(() => this.changed(), FILES_SETTLE_MS)
      })
      // The Project's folder went away: it has no Maps left to watch.
      this.files.on('error', () => this.closeFiles())
    } catch {
      // A Project folder that is gone has no Maps to watch.
    }
  }

  private closeFiles(): void {
    clearTimeout(this.settling)
    this.files?.close()
    this.files = null
  }

  private stop(): void {
    this.closeFiles()
    clearInterval(this.polling)
    this.polling = undefined
  }
}
