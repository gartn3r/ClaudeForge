import { spawn, type ChildProcess } from 'node:child_process'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import type { SessionSummary } from '../../src/shared/api'
import { createFakeEnvironment, encodeProjectPath, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const SIZE = { cols: 100, rows: 30 }

// Fixture Sessions (test/fixtures/claude-home/sessions), all on the fixture list of Session ids.
const OPENAPI_EXPORT = '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11'
const MEAL_PLANNER = '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7'

// Conversations from the CLI, never run in ClaudeForge.
const CLI_HISTORY = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d'
const CLI_RUNNING = '7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e'

/** Drops the escape sequences ConPTY wraps around text, leaving what reads on screen. */
const plain = (output: string): string =>
  // eslint-disable-next-line no-control-regex -- escape sequences start with ESC and may end with BEL
  output.replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, '')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const children: ChildProcess[] = []

/** A process that stays alive until the test ends, standing in for a `claude` run elsewhere. */
function runningProcess(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { stdio: 'ignore' })
  children.push(child)
  return child
}

describe('the list of Session ids', () => {
  let env: FakeEnvironment
  const backends: Backend[] = []

  const start = (): Backend => {
    const backend = startBackend(env)
    backends.push(backend)
    return backend
  }

  const ids = async (backend: Backend): Promise<string[]> =>
    (await backend.api.sessions.list()).flatMap((project) => project.sessions.map((session) => session.id))

  const sessionOf = async (backend: Backend, id: string): Promise<SessionSummary | undefined> =>
    (await backend.api.sessions.list()).flatMap((project) => project.sessions).find((session) => session.id === id)

  /** Writes a conversation from the CLI in dotfiles: a finished one, and one whose `claude` still runs. */
  const writeCliConversations = async (): Promise<void> => {
    const cwd = env.projects.dotfiles
    const entry = { type: 'user', cwd, timestamp: '2026-10-25T12:00:00.000Z', message: { role: 'user', content: 'Tidy my aliases' } }
    await env.writeHistory(cwd, CLI_HISTORY, [entry], { listed: false })
    await env.writeLiveSession({ pid: runningProcess().pid!, sessionId: CLI_RUNNING, cwd }, { listed: false })
  }

  /** Everything a Hosted session has printed so far, by id. */
  let outputs: Map<string, string>
  const startWatching = (backend: Backend): Backend => {
    outputs = new Map()
    backend.on('sessionHost.output', ({ id, data }) => outputs.set(id, (outputs.get(id) ?? '') + data))
    return backend
  }
  const waitForText = (id: string, text: string): Promise<void> =>
    vi.waitFor(() => expect(plain(outputs.get(id) ?? '')).toContain(text), { timeout: 15_000, interval: 50 })
  const waitForListed = (id: string): Promise<void> =>
    vi.waitFor(async () => expect(await env.listedSessions()).toContain(id), { timeout: 15_000, interval: 100 })

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    for (const child of children.splice(0)) child.kill()
    for (const backend of backends.splice(0)) backend.dispose()
    await env.dispose()
  })

  describe('the Session catalog', () => {
    it('lists only the conversations on the list, leaving out those that never ran in ClaudeForge, running or not', async () => {
      await writeCliConversations()

      const listed = await ids(start())

      expect(listed).toContain(OPENAPI_EXPORT)
      expect(listed).not.toContain(CLI_HISTORY)
      expect(listed).not.toContain(CLI_RUNNING)
      expect((await start().api.sessions.list()).map((project) => project.name)).not.toContain('dotfiles')
    })

    it('starts empty when ClaudeForge has no list yet, whatever Claude Code holds', async () => {
      await rename(env.sessionIdsFile, `${env.sessionIdsFile}.gone`)

      expect(await start().api.sessions.list()).toEqual([])
      expect(await start().api.sessions.listProblem()).toBeNull()
    })

    it('lists a Session on the list as External while its claude runs in another terminal', async () => {
      const claude = runningProcess()
      await env.writeLiveSession({ pid: claude.pid!, sessionId: OPENAPI_EXPORT, cwd: env.projects['harbor-api'] })

      expect((await sessionOf(start(), OPENAPI_EXPORT))?.state).toBe('external')
    })

    it('lists a Session as Hosted, with its Hosted session, while its claude runs in ClaudeForge, and past once it ends', async () => {
      const backend = startWatching(start())
      const { id, sessionId } = await backend.api.sessionHost.start(env.projects.dotfiles, SIZE)
      await waitForText(id, `Terminal ${SIZE.cols}x${SIZE.rows}`)
      await backend.api.sessionHost.write(id, '/work 300\r')

      await vi.waitFor(async () => expect(await sessionOf(backend, sessionId)).toMatchObject({ state: 'hosted', hostedId: id }), {
        timeout: 15_000
      })
      await expect(backend.api.sessionHost.resume(sessionId, SIZE)).rejects.toThrow('still runs in ClaudeForge')

      await waitForText(id, 'Done.')
      await backend.api.sessionHost.write(id, '/exit\r')
      await vi.waitFor(async () => expect(await sessionOf(backend, sessionId)).toMatchObject({ state: 'past', hostedId: null }), {
        timeout: 15_000
      })
    })

    it('neither resumes, forks, renames, hides nor deletes a conversation not on the list, and keeps its preferences', async () => {
      await writeCliConversations()
      // Named and hidden as a Session in an earlier ClaudeForge, which kept no list.
      await writeFile(
        join(env.userDataDir, 'state.json'),
        JSON.stringify({ version: 1, sessions: { [CLI_HISTORY]: { title: 'Aliases', hidden: true } } })
      )
      const { api } = start()

      await expect(api.sessionHost.resume(CLI_HISTORY, SIZE)).rejects.toThrow()
      await expect(api.sessionHost.fork(CLI_HISTORY, SIZE)).rejects.toThrow()
      await expect(api.sessions.rename(CLI_HISTORY, 'Shell aliases')).rejects.toThrow()
      await expect(api.sessions.setHidden(CLI_HISTORY, false)).rejects.toThrow()
      expect(await api.sessions.delete([CLI_HISTORY])).toEqual({ [CLI_HISTORY]: { deleted: false, reason: 'unknown' } })

      expect(await env.recycled()).toEqual([])
      expect(await env.listedSessions()).not.toContain(CLI_HISTORY)
      // Another Session's rename rewrites the app state, leaving that conversation's preferences as they were.
      await api.sessions.rename(OPENAPI_EXPORT, 'OpenAPI')
      const state = JSON.parse(await readFile(join(env.userDataDir, 'state.json'), 'utf8'))
      expect(state.sessions[CLI_HISTORY]).toEqual({ title: 'Aliases', hidden: true })
    })

    it('keeps a deleted Session on the list, so putting its history back brings it back', async () => {
      const backend = start()
      expect(await backend.api.sessions.delete([OPENAPI_EXPORT])).toEqual({ [OPENAPI_EXPORT]: { deleted: true } })
      expect(await ids(backend)).not.toContain(OPENAPI_EXPORT)
      expect(await env.listedSessions()).toContain(OPENAPI_EXPORT)

      // Restored from the Recycle Bin, as Windows puts it back where it was: the stand-in keeps it in slot 0.
      const history = join(env.claudeHome, 'projects', encodeProjectPath(env.projects['harbor-api']), `${OPENAPI_EXPORT}.jsonl`)
      expect(await env.recycled()).toEqual([history])
      await rename(join(env.processEnv.CLAUDEFORGE_RECYCLE_BIN!, `0-${OPENAPI_EXPORT}.jsonl`, `${OPENAPI_EXPORT}.jsonl`), history)

      expect((await sessionOf(start(), OPENAPI_EXPORT))?.title).toBe('Add an OpenAPI export')
    })
  })

  describe('recording from the Session host', () => {
    it("puts a new Session's id on the list before its claude starts, and keeps it after it ends and across a restart", async () => {
      const backend = startWatching(start())

      const { id, sessionId } = await backend.api.sessionHost.start(env.projects.dotfiles, SIZE)

      expect(sessionId).toMatch(UUID)
      expect(await env.listedSessions()).toContain(sessionId)
      await waitForText(id, `Terminal ${SIZE.cols}x${SIZE.rows}`)
      await backend.api.sessionHost.write(id, '/work 300\r')
      await waitForText(id, 'Done.')
      await backend.api.sessionHost.write(id, '/exit\r')
      await vi.waitFor(async () => expect((await sessionOf(backend, sessionId))?.state).toBe('past'), { timeout: 15_000 })

      expect(await sessionOf(start(), sessionId)).toMatchObject({ title: '/work 300', state: 'past' })
    })

    it("puts a fork's new id on the list, and keeps a resumed Session's", async () => {
      const backend = startWatching(start())

      const fork = await backend.api.sessionHost.fork(MEAL_PLANNER, SIZE)
      const resumed = await backend.api.sessionHost.resume(OPENAPI_EXPORT, SIZE)

      expect(fork.sessionId).not.toBe(MEAL_PLANNER)
      expect(resumed.sessionId).toBe(OPENAPI_EXPORT)
      const listed = await env.listedSessions()
      expect(listed).toContain(fork.sessionId)
      expect(listed.filter((id) => id === OPENAPI_EXPORT)).toHaveLength(1)
    })

    it('puts on the list the Session that /clear moves a Hosted session to, found through its registry entry', async () => {
      const backend = startWatching(start())
      const { id, sessionId } = await backend.api.sessionHost.start(env.projects.dotfiles, SIZE)
      await waitForText(id, `Terminal ${SIZE.cols}x${SIZE.rows}`)

      await backend.api.sessionHost.write(id, '/clear\r')

      await waitForText(id, 'Cleared: ')
      const cleared = /Cleared: ([0-9a-f-]{36})/.exec(plain(outputs.get(id)!))![1]!
      expect(cleared).not.toBe(sessionId)
      await waitForListed(cleared)
      await backend.api.sessionHost.write(id, '/work 300\r')
      await vi.waitFor(async () => expect((await sessionOf(backend, cleared))?.title).toBe('/work 300'), { timeout: 15_000 })
    })

    it('puts on the list a conversation from the CLI that /resume brings into a Hosted session', async () => {
      await writeCliConversations()
      const backend = startWatching(start())
      const { id } = await backend.api.sessionHost.start(env.projects.dotfiles, SIZE)
      await waitForText(id, `Terminal ${SIZE.cols}x${SIZE.rows}`)
      expect(await ids(backend)).not.toContain(CLI_HISTORY)

      await backend.api.sessionHost.write(id, `/resume ${CLI_HISTORY}\r`)

      await waitForListed(CLI_HISTORY)
      await vi.waitFor(async () => expect(await ids(backend)).toContain(CLI_HISTORY), { timeout: 15_000 })
    })

    it('saves every id of Sessions started together, one write after the other, leaving no temporary file', async () => {
      const backend = start()

      const started = await Promise.all(
        (['dotfiles', 'harbor-api', 'recipe-box'] as const).map((project) => backend.api.sessionHost.start(env.projects[project], SIZE))
      )

      const listed = await env.listedSessions()
      for (const { sessionId } of started) expect(listed).toContain(sessionId)
      expect((await readdir(env.userDataDir)).filter((name) => name.includes('session-ids'))).toEqual(['session-ids.json'])
    })
  })

  describe('an unreadable list', () => {
    const CORRUPT = '{"version":1,"ids":["5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11",'

    it('is set aside as it was, never written over, and the user is told where', async () => {
      await writeFile(env.sessionIdsFile, CORRUPT)
      const backend = start()

      const problem = await backend.api.sessions.listProblem()

      expect(problem).toEqual({ file: expect.stringMatching(/session-ids\.unreadable-.+\.json$/), setAside: true })
      expect(dirname(problem!.file)).toBe(env.userDataDir)
      expect(await readFile(problem!.file, 'utf8')).toBe(CORRUPT)
      expect(await backend.api.sessions.list()).toEqual([])
    })

    it('makes way for a new list, which records from then on', async () => {
      await writeFile(env.sessionIdsFile, JSON.stringify({ version: 1, ids: 'not a list' }))
      const backend = start()
      expect(await backend.api.sessions.listProblem()).not.toBeNull()

      const { sessionId } = await backend.api.sessionHost.start(env.projects.dotfiles, SIZE)

      expect(await env.listedSessions()).toEqual([sessionId])
      expect(await start().api.sessions.listProblem()).toBeNull()
    })
  })

  describe('saved tabs', () => {
    it('drops, from the app state, the saved tabs of conversations not on the list, which are never reopened', async () => {
      await writeCliConversations()
      const harbor = env.projects['harbor-api']
      const dotfiles = env.projects.dotfiles
      await start().api.appState.write({
        tabs: [
          { sessionId: CLI_HISTORY, project: dotfiles, title: 'Tidy my aliases' },
          { sessionId: OPENAPI_EXPORT, project: harbor, title: 'Add an OpenAPI export' },
          { sessionId: CLI_RUNNING, project: dotfiles, title: null }
        ]
      })

      const { tabs } = await start().api.appState.read()

      expect(tabs).toEqual([{ sessionId: OPENAPI_EXPORT, project: harbor, title: 'Add an OpenAPI export' }])
      expect(JSON.parse(await readFile(join(env.userDataDir, 'state.json'), 'utf8')).tabs).toEqual(tabs)
    })
  })
})
