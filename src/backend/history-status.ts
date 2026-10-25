import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostedSessionStatus } from '../shared/api'

/** How often the history is checked for new entries. */
const POLL_MS = 500
/** Until the history turns up in the folder Claude Code names after the Session's, every this many checks look in all of them. */
const SCAN_EVERY = 10

/** One line of a Session history, as Claude Code writes it. */
type HistoryEntry = Record<string, unknown>

const INTERRUPTED = '[Request interrupted by user'

/** The text parts of a history entry's message. */
function messageTexts(entry: HistoryEntry): string[] {
  const content = (entry.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
}

/**
 * What one history entry says the Session is doing; null for an entry that says nothing about it.
 * The user's message (a prompt, or a tool's result) keeps Claude working, as does Claude asking for
 * a tool; Claude's message that ends the turn leaves it done; an interruption leaves it at rest.
 * A history cannot tell a tool that runs from a permission prompt, so it never says waiting.
 */
function statusOfEntry(entry: HistoryEntry): HostedSessionStatus | null {
  if (entry.isSidechain || entry.isMeta) return null
  if (entry.type === 'user') {
    return messageTexts(entry).some((text) => text.startsWith(INTERRUPTED)) ? 'idle' : 'working'
  }
  if (entry.type !== 'assistant') return null
  const stopReason = (entry.message as { stop_reason?: unknown } | undefined)?.stop_reason
  return stopReason === 'end_turn' || stopReason === 'stop_sequence' || stopReason === 'max_tokens' ? 'done' : 'working'
}

const isFile = (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false)

/** The bytes of a file from an offset on; null when it cannot be read right now. */
async function readFrom(file: string, offset: number): Promise<Buffer | null> {
  try {
    const handle = await open(file, 'r')
    try {
      const { size } = await handle.stat()
      if (size <= offset) return null
      const buffer = Buffer.alloc(size - offset)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/**
 * Follows a Session's history (`<claude home>/projects/<folder>/<session id>.jsonl`) as Claude
 * Code appends to it, for a `claude` that sends its terminal no status signals. Only entries
 * appended after it started count, so a resumed Session's past turns say nothing.
 */
export class HistoryStatus {
  private file: string | null = null
  /** How far the file has been read, in bytes: always to the end of a whole line. */
  private offset = 0
  private checks = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly claudeHome: string,
    /** The folder the Session runs in, which Claude Code names its history folder after. */
    private readonly cwd: string,
    private readonly sessionId: string,
    private readonly onStatus: (status: HostedSessionStatus) => void
  ) {
    // A resumed Session's history is there already: only what follows counts.
    void this.skipExisting().finally(() => this.schedule())
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
  }

  private async skipExisting(): Promise<void> {
    this.file = await this.findHistory(true)
    if (this.file) this.offset = await stat(this.file).then((info) => info.size, () => 0)
  }

  /**
   * The history file, in the folder Claude Code names after the Session's (every character but a
   * letter or digit a dash), else, when asked to scan, in any Project folder; null until it exists.
   */
  private async findHistory(scan: boolean): Promise<string | null> {
    const root = join(this.claudeHome, 'projects')
    const named = join(root, this.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${this.sessionId}.jsonl`)
    if (await isFile(named)) return named
    if (!scan) return null
    for (const folder of await readdir(root).catch(() => [])) {
      const file = join(root, folder, `${this.sessionId}.jsonl`)
      if (await isFile(file)) return file
    }
    return null
  }

  private schedule(): void {
    if (!this.stopped) this.timer = setTimeout(() => void this.poll().finally(() => this.schedule()), POLL_MS)
  }

  private async poll(): Promise<void> {
    this.file ??= await this.findHistory(++this.checks % SCAN_EVERY === 0)
    if (!this.file) return
    const buffer = await readFrom(this.file, this.offset)
    // A line Claude Code is still writing waits for the next check.
    const end = buffer?.lastIndexOf(0x0a) ?? -1
    if (!buffer || end < 0) return
    this.offset += end + 1
    // Every status the new entries went through, so a whole turn read at once still starts and ends.
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      let status: HostedSessionStatus | null = null
      try {
        status = statusOfEntry(JSON.parse(line) as HistoryEntry)
      } catch {
        // Not an entry ClaudeForge can read.
      }
      if (status && !this.stopped) this.onStatus(status)
    }
  }
}
