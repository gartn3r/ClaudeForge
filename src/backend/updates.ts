import type { UpdateStatus } from '../shared/api'

/** ClaudeForge's own updater: in an installed ClaudeForge, electron-updater on GitHub releases. */
export interface Updater {
  /** Looks for a newer release and starts downloading it; rejects when the releases cannot be read. */
  check(): Promise<void>
  /** Calls back once a newer version is downloaded, to install when ClaudeForge closes; returns an unsubscribe. */
  onDownloaded(listener: (version: string) => void): () => void
}

/** How often a running ClaudeForge looks for a newer release, on top of when it starts. */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Keeps ClaudeForge up to date: looks for a newer release when it starts and every few hours, until
 * one is downloaded. Without an updater (development builds, tests) it stays current.
 */
export class Updates {
  private status: UpdateStatus = { state: 'current' }
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly unsubscribe: (() => void) | undefined

  constructor(
    private readonly updater: Updater | undefined,
    private readonly onChange: (status: UpdateStatus) => void
  ) {
    if (!updater) return
    this.unsubscribe = updater.onDownloaded((version) => this.downloaded(version))
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS)
    this.check()
  }

  current(): UpdateStatus {
    return this.status
  }

  dispose(): void {
    clearInterval(this.timer)
    this.unsubscribe?.()
  }

  private check(): void {
    // Offline, or GitHub unreachable: the next check tries again.
    this.updater?.check().catch(() => undefined)
  }

  private downloaded(version: string): void {
    clearInterval(this.timer)
    this.status = { state: 'ready', version }
    this.onChange(this.status)
  }
}
