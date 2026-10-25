import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import type { SessionSummary } from '../../src/shared/api'
import { createFakeEnvironment, encodeProjectPath, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const OPENAPI_EXPORT = '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11'
/** Runs in another terminal: External. */
const RATE_LIMITER = '9c1e4b2a-6d3f-4e8b-8a17-3b5d2e9f0c42'

describe('tidying the explorer', () => {
  let env: FakeEnvironment
  const backends: Backend[] = []

  const start = (): Backend => {
    const backend = startBackend(env)
    backends.push(backend)
    return backend
  }

  const sessionOf = async (backend: Backend, id: string): Promise<SessionSummary | undefined> =>
    (await backend.api.sessions.list()).flatMap((project) => project.sessions).find((session) => session.id === id)

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    for (const backend of backends.splice(0)) backend.dispose()
    await env.dispose()
  })

  describe('rename', () => {
    it("titles the Session with the user's name for it, across a restart, leaving Claude Code's files untouched", async () => {
      const historyFile = join(env.claudeHome, 'projects', encodeProjectPath(env.projects['harbor-api']), `${OPENAPI_EXPORT}.jsonl`)
      const history = await readFile(historyFile, 'utf8')

      await start().api.sessions.rename(OPENAPI_EXPORT, '  OpenAPI, for the partners  ')

      expect((await sessionOf(start(), OPENAPI_EXPORT))?.title).toBe('OpenAPI, for the partners')
      expect(await readFile(historyFile, 'utf8')).toBe(history)
    })

    it('pushes the renamed Session to the interface', async () => {
      const backend = start()
      const pushed: (string | null | undefined)[] = []
      backend.on('sessions.changed', (projects) =>
        pushed.push(projects.flatMap((project) => project.sessions).find((session) => session.id === OPENAPI_EXPORT)?.title)
      )

      await backend.api.sessions.rename(OPENAPI_EXPORT, 'OpenAPI, for the partners')

      expect(pushed).toEqual(['OpenAPI, for the partners'])
    })

    it("gives the Session back Claude Code's name when renamed to nothing", async () => {
      const backend = start()
      await backend.api.sessions.rename(OPENAPI_EXPORT, 'OpenAPI, for the partners')

      await backend.api.sessions.rename(OPENAPI_EXPORT, ' ')

      expect((await sessionOf(backend, OPENAPI_EXPORT))?.title).toBe('Add an OpenAPI export')
    })
  })

  describe('hide', () => {
    it('marks a Session hidden, across a restart, and unhides it', async () => {
      expect((await sessionOf(start(), OPENAPI_EXPORT))?.hidden).toBe(false)

      await start().api.sessions.setHidden(OPENAPI_EXPORT, true)
      expect((await sessionOf(start(), OPENAPI_EXPORT))?.hidden).toBe(true)

      await start().api.sessions.setHidden(OPENAPI_EXPORT, false)
      expect((await sessionOf(start(), OPENAPI_EXPORT))?.hidden).toBe(false)
    })
  })

  describe('delete', () => {
    const historyFolder = (cwd: string): string => join(env.claudeHome, 'projects', encodeProjectPath(cwd))

    it("moves every history file of a past Session to the Recycle Bin, and it leaves the catalog", async () => {
      const harbor = historyFolder(env.projects['harbor-api'])
      // Claude Code keeps a Session's subagent transcripts in a folder named after it, beside its history.
      await mkdir(join(harbor, OPENAPI_EXPORT, 'subagents'), { recursive: true })
      await writeFile(join(harbor, OPENAPI_EXPORT, 'subagents', 'agent-a1.jsonl'), '')
      // The Session also ran in another folder for a while, leaving a history file there too.
      await env.writeHistory(env.projects.dotfiles, OPENAPI_EXPORT, [
        { type: 'user', cwd: env.projects.dotfiles, timestamp: '2026-10-21T08:00:00.000Z', message: { role: 'user', content: 'Export it here too' } }
      ])
      const backend = start()

      expect(await backend.api.sessions.delete(OPENAPI_EXPORT)).toEqual({ deleted: true })

      expect((await env.recycled()).sort()).toEqual(
        [
          join(harbor, `${OPENAPI_EXPORT}.jsonl`),
          join(harbor, OPENAPI_EXPORT),
          join(historyFolder(env.projects.dotfiles), `${OPENAPI_EXPORT}.jsonl`)
        ].sort()
      )
      expect(await sessionOf(backend, OPENAPI_EXPORT)).toBeUndefined()
      expect(await sessionOf(backend, RATE_LIMITER)).toBeDefined()
    })

    it('pushes the catalog without the Session, and forgets how the user tidied it', async () => {
      const backend = start()
      await backend.api.sessions.rename(OPENAPI_EXPORT, 'OpenAPI, for the partners')
      await backend.api.sessions.setHidden(OPENAPI_EXPORT, true)
      const pushed: boolean[] = []
      backend.on('sessions.changed', (projects) =>
        pushed.push(projects.some((project) => project.sessions.some((session) => session.id === OPENAPI_EXPORT)))
      )

      await backend.api.sessions.delete(OPENAPI_EXPORT)

      expect(pushed).toEqual([false])
      expect((await start().api.appState.read()).sessions).toEqual({})
    })

    it('is refused for an External session, whose history stays where it is', async () => {
      const backend = start()

      expect(await backend.api.sessions.delete(RATE_LIMITER)).toEqual({ deleted: false, reason: 'external' })

      expect(await env.recycled()).toEqual([])
      expect((await sessionOf(backend, RATE_LIMITER))?.state).toBe('external')
    })

    it('is refused for a Session the catalog does not know', async () => {
      const backend = start()

      expect(await backend.api.sessions.delete('00000000-0000-4000-8000-000000000000')).toEqual({
        deleted: false,
        reason: 'unknown'
      })
      expect(await env.recycled()).toEqual([])
    })
  })
})
