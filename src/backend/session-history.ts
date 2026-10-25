import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { createInterface } from 'node:readline'

/** What the explorer needs from one Session history file. */
export interface HistorySummary {
  /** The folder the Session started in. */
  cwd: string | null
  /** The start of the first message the user typed, cleaned of Claude Code's markup. */
  firstMessage: string | null
  /** The name set with /rename or by the app hosting the Session. */
  customTitle: string | null
  /** The name Claude Code generated for the Session. */
  aiTitle: string | null
  /** The newest entry's time, in milliseconds since the epoch. */
  lastActivity: number | null
  /** The arguments of the latest `/wayfinder` invocation (`meal-planner 02`), `''` for none; null when never invoked. */
  wayfinder: string | null
}

// History files reach hundreds of megabytes, so only their two ends are read, as
// Claude Code's own resume picker does: the head holds the cwd and first message,
// the tail the latest name and activity (Claude Code appends its title entries again
// as the Session goes on).
const HEAD_MAX_LINES = 400
const TAIL_BYTES = 256 * 1024
const TITLE_MAX_LENGTH = 200

type Entry = Record<string, unknown>

function parse(line: string): Entry | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Entry) : null
  } catch {
    return null
  }
}

const COMMAND = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const TAG = /<\/?[a-z][\w-]*(?:\s[^<>]*)?>/gi

/** A user message as a one-line title: slash commands as typed, Claude Code's markup removed. */
function titleFrom(text: string): string | null {
  const command = COMMAND.exec(text)
  const plain = command
    ? `${command[1]} ${COMMAND_ARGS.exec(text)?.[1] ?? ''}`
    : text.replace(SYSTEM_REMINDER, ' ').replace(TAG, ' ')
  const line = plain.replace(/\s+/g, ' ').trim()
  return line ? line.slice(0, TITLE_MAX_LENGTH) : null
}

/** The raw text of a message the user typed in a history entry, or null for anything else. */
function typedText(entry: Entry): string | null {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null
  const content = (entry.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = content
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
  return texts.length ? texts.join('\n') : null
}

/** The text the user typed in a history entry, as a title, or null for anything else. */
function typedMessage(entry: Entry): string | null {
  const text = typedText(entry)
  return text === null ? null : titleFrom(text)
}

// `/wayfinder`, or `/<plugin>:wayfinder` when Wayfinder comes with a plugin. Like the title,
// it is read from the two ends only: Wayfinder runs each Ticket in a fresh Session, so the
// invocation is the first message or a recent one; one buried mid-way in a long history is missed.
const WAYFINDER_COMMAND = /<command-name>\/(?:[^<:\s]+:)?wayfinder<\/command-name>/

/** The arguments of a `/wayfinder` invocation in a history entry, or null when it holds none. */
function wayfinderArgs(entry: Entry): string | null {
  const text = typedText(entry)
  if (text === null || !WAYFINDER_COMMAND.test(text)) return null
  return COMMAND_ARGS.exec(text)?.[1]?.trim() ?? ''
}

async function readHead(file: string, summary: HistorySummary): Promise<void> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let count = 0
  try {
    for await (const line of lines) {
      const entry = parse(line)
      if (entry) {
        if (!summary.cwd && typeof entry.cwd === 'string') summary.cwd = entry.cwd
        if (!summary.firstMessage) summary.firstMessage = typedMessage(entry)
        summary.wayfinder = wayfinderArgs(entry) ?? summary.wayfinder
      }
      if ((summary.cwd && summary.firstMessage) || ++count >= HEAD_MAX_LINES) break
    }
  } finally {
    lines.close()
    stream.destroy()
  }
}

async function readTail(file: string, summary: HistorySummary): Promise<void> {
  const handle = await open(file, 'r')
  let text: string
  let start: number
  try {
    const { size } = await handle.stat()
    start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    text = buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
  const lines = text.split('\n')
  // The first line of a window that starts mid-file is a fragment.
  if (start > 0) lines.shift()
  let latestWayfinder: string | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parse(lines[i]!)
    if (!entry) continue
    latestWayfinder ??= wayfinderArgs(entry)
    if (summary.customTitle === null && entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
      summary.customTitle = entry.customTitle.trim() || null
    }
    if (summary.aiTitle === null && entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
      summary.aiTitle = entry.aiTitle.trim() || null
    }
    if (summary.lastActivity === null && typeof entry.timestamp === 'string') {
      const time = Date.parse(entry.timestamp)
      if (!Number.isNaN(time)) summary.lastActivity = time
    }
  }
  // An invocation in the tail is the latest; one in the head counts only when the tail has none.
  summary.wayfinder = latestWayfinder ?? summary.wayfinder
}

/** Reads what the explorer needs from one `<session-id>.jsonl` history file. */
export async function readHistory(file: string): Promise<HistorySummary> {
  const summary: HistorySummary = {
    cwd: null,
    firstMessage: null,
    customTitle: null,
    aiTitle: null,
    lastActivity: null,
    wayfinder: null
  }
  await readHead(file, summary)
  await readTail(file, summary)
  return summary
}
