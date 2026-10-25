import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostedSessionStatus } from '../shared/api'

/** How often the history is checked for new entries. */
const POLL_MS = 500

type Entry = Record<string, unknown>

const INTERRUPTED = '[Request interrupted by user'

/** The text parts of a history message. */
function texts(entry: Entry): string[] {
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
function statusOf(entry: Entry): HostedSessionStatus | null {
  if (entry.isSidechain || entry.isMeta) return null
  if (entry.type === 'user') return texts(entry).some((text) => text.startsWith(INTERRUPTED)) ? 'idle' : 'working'
  if (entry.type !== 'assistant') return null
  const stopReason = (entry.message as { stop_reason?: unknown } | undefined)?.stop_reason
  return stopReason === 'end_turn' || stopReason === 'stop_sequence' || stopReason === 'max_tokens' ? 'done' : 'working'
}

/** The history file of a Session, in whichever Project folder Claude Code keeps it; null until it exists. */
async function findHistory(claudeHome: string, sessionId: string): Promise<string | null> {
  const root = join(claudeHome, 'projects')
  const folders = await readdir(root).catch(() => [])
  for (const folder of folders) {
    const file = join(root, folder, `${sessionId}.jsonl`)
    if (await stat(file).then((info) => info.isFile(), () => false)) return file
  }
  return null
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
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly claudeHome: string,
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
    this.file = await findHistory(this.claudeHome, this.sessionId)
    if (this.file) this.offset = await stat(this.file).then((info) => info.size, () => 0)
  }

  private schedule(): void {
    if (!this.stopped) this.timer = setTimeout(() => void this.poll().finally(() => this.schedule()), POLL_MS)
  }

  private async poll(): Promise<void> {
    this.file ??= await findHistory(this.claudeHome, this.sessionId)
    if (!this.file) return
    const size = await stat(this.file).then((info) => info.size, () => this.offset)
    if (size <= this.offset) return
    const handle = await open(this.file, 'r')
    try {
      const buffer = Buffer.alloc(size - this.offset)
      await handle.read(buffer, 0, buffer.length, this.offset)
      // A line Claude Code is still writing waits for the next check.
      const end = buffer.lastIndexOf(0x0a)
      if (end < 0) return
      this.offset += end + 1
      const lines = buffer.subarray(0, end).toString('utf8').split('\n')
      // Every status the new entries went through, so a whole turn read at once still starts and ends.
      for (const line of lines) {
        let status: HostedSessionStatus | null = null
        try {
          status = statusOf(JSON.parse(line) as Entry)
        } catch {
          // Not an entry ClaudeForge can read.
        }
        if (status && !this.stopped) this.onStatus(status)
      }
    } finally {
      await handle.close()
    }
  }
}
