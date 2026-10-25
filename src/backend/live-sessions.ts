import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A running `claude` process, from Claude Code's live-session registry. */
export interface LiveSession {
  pid: number
  sessionId: string
  cwd: string
  /** The Session's current name, when it has one. */
  name: string | null
  /** When the process last reported a change, in milliseconds since the epoch. */
  updatedAt: number | null
  /** The process's creation time as a Windows FILETIME, when Claude Code recorded it. */
  procStart: string | null
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

/** Whether a process was checked to be the one that wrote a registry entry, by pid and creation time. */
const startChecks = new Map<string, Promise<boolean>>()

/**
 * Windows hands a dead process's id to the next program soon enough, so an entry a crashed
 * `claude` left behind can name a running process that is not it. The creation time Claude
 * Code records tells them apart. Checked once per entry; a check that cannot run trusts the id.
 */
function isSameProcess(pid: number, procStart: string | null): Promise<boolean> {
  if (process.platform !== 'win32' || !procStart) return Promise.resolve(true)
  const key = `${pid}:${procStart}`
  let check = startChecks.get(key)
  if (!check) {
    check = run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`],
      { windowsHide: true }
    ).then(
      ({ stdout }) => !stdout.trim() || stdout.trim() === procStart,
      () => true
    )
    startChecks.set(key, check)
  }
  return check
}

function parseEntry(text: string): LiveSession | null {
  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const { pid, sessionId, cwd, name, updatedAt, procStart } = entry
  if (typeof pid !== 'number' || typeof sessionId !== 'string' || typeof cwd !== 'string') return null
  return {
    pid,
    sessionId,
    cwd,
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : null,
    procStart: typeof procStart === 'string' ? procStart : null
  }
}

/**
 * The Sessions whose `claude` process is running, from `<claude home>/sessions/<pid>.json`.
 * An entry whose process is gone (Claude Code crashed or was killed) is ignored, even when
 * Windows has since given its process id to another program.
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
  const running = await Promise.all(
    entries.map(async (entry) => entry !== null && isRunning(entry.pid) && (await isSameProcess(entry.pid, entry.procStart)))
  )
  return entries.filter((entry, i): entry is LiveSession => running[i]!)
}
