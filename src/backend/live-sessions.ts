import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A running `claude` process, from Claude Code's live-session registry. */
export interface LiveSession {
  pid: number
  sessionId: string
  cwd: string
  /** The Session's current name, when it has one. */
  name: string | null
  /** When the process last reported a change, in milliseconds since the epoch. */
  updatedAt: number | null
}

/** Whether a process with this id is running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it runs, under another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function parseEntry(text: string): LiveSession | null {
  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const { pid, sessionId, cwd, name, updatedAt } = entry
  if (typeof pid !== 'number' || typeof sessionId !== 'string' || typeof cwd !== 'string') return null
  return {
    pid,
    sessionId,
    cwd,
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : null
  }
}

/**
 * The Sessions whose `claude` process is running, from `<claude home>/sessions/<pid>.json`.
 * An entry whose process is gone (Claude Code crashed or was killed) is ignored.
 */
export async function readLiveSessions(claudeHome: string): Promise<LiveSession[]> {
  const dir = join(claudeHome, 'sessions')
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const entries = await Promise.all(
    files
      .filter((file) => /^\d+\.json$/.test(file))
      .map(async (file) => parseEntry(await readFile(join(dir, file), 'utf8').catch(() => '')))
  )
  return entries.filter((entry): entry is LiveSession => entry !== null && isRunning(entry.pid))
}
