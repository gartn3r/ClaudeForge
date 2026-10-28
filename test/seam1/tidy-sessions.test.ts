import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import type { SessionSummary } from '../../src/shared/api'
import { createFakeEnvironment, encodeProjectPath, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const OPENAPI_EXPORT = '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11'
/** Runs in another terminal: External. */
const RATE_LIMITER = '9c1e4b2a-6d3f-4e8b-8a17-3b5d2e9f0c42'
const AUDIT_LOG = 'c3d2a8f1-1b7e-4c59-9e64-7f0a1d2b3c4d'
const MEAL_PLANNER = '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7'
const UNKNOWN = '00000000-0000-4000-8000-000000000000'

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

  it('keeps a name no longer than the titles Claude Code yields', async () => {
    const backend = start()

    await backend.api.sessions.rename(OPENAPI_EXPORT, 'x'.repeat(500))

    expect((await sessionOf(backend, OPENAPI_EXPORT))?.title).toHaveLength(200)
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

      expect(await backend.api.sessions.delete([OPENAPI_EXPORT])).toEqual({ [OPENAPI_EXPORT]: { deleted: true } })

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

    it('pushes the catalog without the Session', async () => {
      const backend = start()
      const pushed: boolean[] = []
      backend.on('sessions.changed', (projects) =>
        pushed.push(projects.some((project) => project.sessions.some((session) => session.id === OPENAPI_EXPORT)))
      )

      await backend.api.sessions.delete([OPENAPI_EXPORT])

      expect(pushed).toEqual([false])
    })

    it('forgets how the user tidied it, so restored from the Recycle Bin it comes back as Claude Code left it', async () => {
      const backend = start()
      await backend.api.sessions.rename(OPENAPI_EXPORT, 'OpenAPI, for the partners')
      await backend.api.sessions.setHidden(OPENAPI_EXPORT, true)
      const historyFile = join(historyFolder(env.projects['harbor-api']), `${OPENAPI_EXPORT}.jsonl`)
      const history = await readFile(historyFile, 'utf8')

      await backend.api.sessions.delete([OPENAPI_EXPORT])
      await writeFile(historyFile, history)

      expect(await sessionOf(start(), OPENAPI_EXPORT)).toMatchObject({ title: 'Add an OpenAPI export', hidden: false })
    })

    it('is refused for an External session, whose history stays where it is', async () => {
      const backend = start()

      expect(await backend.api.sessions.delete([RATE_LIMITER])).toEqual({ [RATE_LIMITER]: { deleted: false, reason: 'external' } })

      expect(await env.recycled()).toEqual([])
      expect((await sessionOf(backend, RATE_LIMITER))?.state).toBe('external')
    })

    it('is refused for a Session the catalog does not know', async () => {
      const backend = start()

      expect(await backend.api.sessions.delete([UNKNOWN])).toEqual({ [UNKNOWN]: { deleted: false, reason: 'unknown' } })
      expect(await env.recycled()).toEqual([])
    })

    it('deletes each Session of a batch on its own: one whose files are held open fails, the others still go', async () => {
      const harbor = historyFolder(env.projects['harbor-api'])
      // A subagent transcript held open, as an editor would: Windows refuses to move its folder.
      await mkdir(join(harbor, AUDIT_LOG, 'subagents'), { recursive: true })
      const transcript = join(harbor, AUDIT_LOG, 'subagents', 'agent-a1.jsonl')
      await writeFile(transcript, '')
      const held = await open(transcript)
      const backend = start()
      const pushed: string[][] = []
      backend.on('sessions.changed', (projects) =>
        pushed.push(projects.flatMap((project) => project.sessions.map((session) => session.id)))
      )
      await backend.api.sessions.setHidden(MEAL_PLANNER, true)
      pushed.length = 0

      try {
        expect(await backend.api.sessions.delete([OPENAPI_EXPORT, AUDIT_LOG, RATE_LIMITER, MEAL_PLANNER])).toEqual({
          [OPENAPI_EXPORT]: { deleted: true },
          [AUDIT_LOG]: { deleted: false, reason: 'failed' },
          [RATE_LIMITER]: { deleted: false, reason: 'external' },
          [MEAL_PLANNER]: { deleted: true }
        })
      } finally {
        await held.close()
      }

      expect(await env.recycled()).toEqual([
        join(harbor, `${OPENAPI_EXPORT}.jsonl`),
        join(historyFolder(env.projects['recipe-box']), `${MEAL_PLANNER}.jsonl`)
      ])
      // One push once the whole batch is done, without the deleted Sessions.
      expect(pushed).toHaveLength(1)
      expect(pushed[0]).not.toContain(OPENAPI_EXPORT)
      expect(pushed[0]).not.toContain(MEAL_PLANNER)
      expect(pushed[0]).toEqual(expect.arrayContaining([AUDIT_LOG, RATE_LIMITER]))
      expect(JSON.stringify((await backend.api.appState.read()).sessions)).not.toContain(MEAL_PLANNER)
    })
  })
})
