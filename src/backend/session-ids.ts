import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionListProblem } from '../shared/api'

export const SESSION_IDS_FILE = 'session-ids.json'

/** The list's ids, or null when the text is not a list ClaudeForge wrote. */
function parseIds(text: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { ids } = parsed as { ids?: unknown }
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null
  return ids
}

/** Where an unreadable list is set aside, beside it: `session-ids.unreadable-<time>.json`. */
const setAsidePath = (dir: string): string =>
  join(dir, `session-ids.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

interface LoadedList {
  ids: Set<string>
  problem: SessionListProblem | null
  /** False when an unreadable list could not be set aside: writing would replace it. */
  writable: boolean
}

/**
 * The list of Session ids: every Claude Code conversation that ran in a ClaudeForge terminal (ADR
 * 0005), kept in its own file in ClaudeForge's data folder, apart from the app state. It only ever
 * grows. Writes are serialised and atomic; an unreadable file is never written over but set aside,
 * and the list starts again empty.
 */
export class SessionIdStore {
  private readonly file: string
  private loaded: Promise<LoadedList> | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {
    this.file = join(dir, SESSION_IDS_FILE)
  }

  /** Every Session id on the list. */
  async ids(): Promise<ReadonlySet<string>> {
    return (await this.load()).ids
  }

  /** Why the list ClaudeForge found was unreadable, once it read it; null when it was fine. */
  async problem(): Promise<SessionListProblem | null> {
    return (await this.load()).problem
  }

  /** Puts a Session id on the list, for good; resolves once it is saved. */
  add(id: string): Promise<void> {
    const next = this.queue.then(async () => {
      const list = await this.load()
      if (list.ids.has(id)) return
      list.ids.add(id)
      if (list.writable) await this.save([...list.ids])
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private load(): Promise<LoadedList> {
    this.loaded ??= this.read()
    return this.loaded
  }

  private async read(): Promise<LoadedList> {
    let text: string | undefined
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ids: new Set(), problem: null, writable: true }
    }
    const ids = text === undefined ? null : parseIds(text)
    if (ids) return { ids: new Set(ids), problem: null, writable: true }
    // The list is the only record of which conversations are ClaudeForge's: keep it for the user.
    const aside = setAsidePath(this.dir)
    try {
      await rename(this.file, aside)
      return { ids: new Set(), problem: { file: aside, setAside: true }, writable: true }
    } catch {
      return { ids: new Set(), problem: { file: this.file, setAside: false }, writable: false }
    }
  }

  private async save(ids: string[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, ids }, null, 2), 'utf8')
    await rename(tmp, this.file)
  }
}
