import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import { missingFolderOf, type HostedSessionStatus } from '../../src/shared/api'
import { COMPILE_TIMEOUT, createChildProcessLister, type ChildProcessLister } from '../child-processes'
import { createFakeEnvironment, type FakeEnvironment, type FakeEnvironmentOptions, type FixtureProject } from '../fake-env'
import { startBackend } from './backend'

/** Drops the escape sequences ConPTY wraps around text, leaving what reads on screen. */
const plain = (output: string): string =>
  // eslint-disable-next-line no-control-regex -- escape sequences start with ESC and may end with BEL
  output.replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, '')

const SIZE = { cols: 100, rows: 30 }

// Fixture Sessions (test/fixtures/claude-home/sessions): a past one and an External one of
// harbor-api, one whose External `claude` crashed, and one in a git worktree of recipe-box.
const PAST_SESSION = '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11'
const RUNNING_EXTERNAL_SESSION = '9c1e4b2a-6d3f-4e8b-8a17-3b5d2e9f0c42'
const ENDED_EXTERNAL_SESSION = 'c3d2a8f1-1b7e-4c59-9e64-7f0a1d2b3c4d'
const WORKTREE_SESSION = 'e5b8c1d0-2f4a-4b6c-8d9e-0a1b2c3d4e5f'

let processes: ChildProcessLister | undefined
beforeAll(async () => {
  processes = await createChildProcessLister()
}, COMPILE_TIMEOUT)
afterAll(() => processes?.dispose())

/** The names of the processes this test process started, as Windows lists them. */
const childProcessNames = (): Promise<string[]> => processes!.names(process.pid)

describe('the Session host', () => {
  let env: FakeEnvironment | undefined
  let backend: Backend | undefined
  /** Everything each Hosted session has printed so far, by id. */
  let outputs: Map<string, string>
  /** The exit events of the Hosted sessions, oldest first. */
  let exits: Array<{ id: string; exitCode: number }>
  /** The status events of the Hosted sessions, oldest first. */
  let statusEvents: Array<{ id: string; status: HostedSessionStatus }>

  afterEach(async () => {
    backend?.dispose()
    await env?.dispose()
  })

  const start = async (options?: FakeEnvironmentOptions): Promise<Backend> => {
    env = await createFakeEnvironment(options)
    backend = startBackend(env)
    outputs = new Map()
    exits = []
    backend.on('sessionHost.output', ({ id, data }) => outputs.set(id, (outputs.get(id) ?? '') + data))
    backend.on('sessionHost.exit', (exit) => exits.push(exit))
    statusEvents = []
    backend.on('sessionHost.status', (event) => statusEvents.push(event))
    return backend
  }

  /** The statuses a Hosted session went through, oldest first. */
  const statuses = (id: string): HostedSessionStatus[] => statusEvents.filter((event) => event.id === id).map(({ status }) => status)

  /** What a Hosted session has printed so far, as plain text. */
  const output = (id: string): string => plain(outputs.get(id) ?? '')

  const waitForText = (id: string, text: string): Promise<void> =>
    vi.waitFor(() => expect(output(id)).toContain(text), { timeout: 15_000, interval: 50 })

  /** Starts a Session in a fixture Project and waits for the fake `claude` to show its prompt; returns its id. */
  const startSession = async (project: FixtureProject = 'recipe-box'): Promise<string> => {
    const { id } = await backend!.api.sessionHost.start(env!.projects[project], SIZE)
    await waitForText(id, `Terminal ${SIZE.cols}x${SIZE.rows}`)
    return id
  }

  /** The runs of `claude` other than the locator's version checks. */
  const sessionRuns = async () => (await env!.invocations('claude')).filter(({ args }) => args[0] !== '--version')

  it('asks for the Project folder to open, and answers null when the user cancels', async () => {
    env = await createFakeEnvironment()
    let picked: string | undefined = env.projects.dotfiles
    backend = startBackend(env, undefined, { chooseProjectFolder: async () => picked })

    expect(await backend.api.sessionHost.chooseProject()).toBe(env.projects.dotfiles)
    picked = undefined
    expect(await backend.api.sessionHost.chooseProject()).toBeNull()
  })

  it('refuses to start a Session while Claude Code is missing', async () => {
    const { api } = await start({ claude: false })

    await expect(api.sessionHost.start(env!.projects['recipe-box'], SIZE)).rejects.toThrow()
  })

  it('starts claude in the Project with a new Session id, with the environment ConPTY hosts need, and streams its output', async () => {
    const { api } = await start()
    const project = env!.projects['recipe-box']

    const { id, sessionId } = await api.sessionHost.start(project, SIZE)

    await waitForText(id, 'Fake Claude Code')
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await sessionRuns()).toEqual([
      {
        args: ['--session-id', sessionId],
        cwd: project,
        env: expect.objectContaining({ CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1', TERM_PROGRAM: 'ClaudeForge' })
      }
    ])
  })

  it('resumes a past Session with claude --resume <id> in its Project', async () => {
    const { api } = await start()

    const { id, sessionId } = await api.sessionHost.resume(PAST_SESSION, SIZE)

    await waitForText(id, 'Fake Claude Code')
    expect(sessionId).toBe(PAST_SESSION)
    expect(await sessionRuns()).toEqual([
      expect.objectContaining({ args: ['--resume', PAST_SESSION], cwd: env!.projects['harbor-api'] })
    ])
  })

  it('forks a past Session into a new one with claude --resume <id> --fork-session, in its Project', async () => {
    const { api } = await start()

    const { id, sessionId } = await api.sessionHost.fork(PAST_SESSION, SIZE)

    await waitForText(id, 'Fake Claude Code')
    expect(sessionId).not.toBe(PAST_SESSION)
    expect(await sessionRuns()).toEqual([
      expect.objectContaining({
        args: ['--resume', PAST_SESSION, '--fork-session', '--session-id', sessionId],
        cwd: env!.projects['harbor-api']
      })
    ])
  })

  it('refuses to resume or fork a Session whose claude runs outside ClaudeForge, or one it does not know', async () => {
    const { api } = await start()

    await expect(api.sessionHost.resume(RUNNING_EXTERNAL_SESSION, SIZE)).rejects.toThrow()
    await expect(api.sessionHost.fork(RUNNING_EXTERNAL_SESSION, SIZE)).rejects.toThrow()
    await expect(api.sessionHost.resume('00000000-0000-4000-8000-000000000000', SIZE)).rejects.toThrow()

    expect(await sessionRuns()).toEqual([])
  })

  it('resumes an External session once its claude has ended, like any past Session', async () => {
    const { api } = await start()

    const { id } = await api.sessionHost.resume(ENDED_EXTERNAL_SESSION, SIZE)

    await waitForText(id, 'Fake Claude Code')
    expect(await sessionRuns()).toEqual([expect.objectContaining({ args: ['--resume', ENDED_EXTERNAL_SESSION] })])
  })

  it('resumes a Session of a git worktree in that worktree', async () => {
    const { api } = await start()

    const { id } = await api.sessionHost.resume(WORKTREE_SESSION, SIZE)

    await waitForText(id, 'Fake Claude Code')
    expect(await sessionRuns()).toEqual([expect.objectContaining({ cwd: env!.worktrees['recipe-box@week-view'] })])
  })

  it('refuses to start claude in a folder that is gone, naming it, for a resume, a fork or a new Session', async () => {
    const { api } = await start()
    const worktree = env!.worktrees['recipe-box@week-view']!
    const project = join(env!.root, 'removed-project')
    await rm(worktree, { recursive: true })

    for (const [startClaude, folder] of [
      [() => api.sessionHost.resume(WORKTREE_SESSION, SIZE), worktree],
      [() => api.sessionHost.fork(WORKTREE_SESSION, SIZE), worktree],
      [() => api.sessionHost.start(project, SIZE), project]
    ] as const) {
      const failure = await startClaude().then(() => null, (error: unknown) => error)
      expect(missingFolderOf(failure)).toBe(folder)
    }
    expect(await sessionRuns()).toEqual([])
  })

  it('types into the Hosted session, and claude answers in its output', async () => {
    const { api } = await start()
    const id = await startSession()

    await api.sessionHost.write(id, 'hello\r')

    await waitForText(id, 'You wrote: "hello"')
  })

  it('starts claude with text typed in its prompt but not sent, which the user sends with Enter', async () => {
    const { api } = await start()
    const project = env!.projects['recipe-box']

    const { id } = await api.sessionHost.start(project, SIZE, { prefill: '/wayfinder meal-planner 02' })

    await waitForText(id, '> /wayfinder meal-planner 02')
    expect(await sessionRuns()).toEqual([
      expect.objectContaining({ args: ['--prefill', '/wayfinder meal-planner 02', '--session-id', expect.any(String)], cwd: project })
    ])
    expect(output(id)).not.toContain('You wrote')
    expect(statuses(id)).toEqual([])

    await api.sessionHost.write(id, '\r')

    await waitForText(id, 'You wrote: "/wayfinder meal-planner 02"')
  })

  it('refuses text to type that cmd.exe would change on its way to a claude it runs as a batch file', async () => {
    const { api } = await start()
    const project = env!.projects['recipe-box']

    for (const prefill of ['/wayfinder 100%done%', '/wayfinder "meal planner"', '/wayfinder meal-planner\r02']) {
      await expect(api.sessionHost.start(project, SIZE, { prefill })).rejects.toThrow()
    }
    expect(await sessionRuns()).toEqual([])
  })

  it('gives claude the terminal size it starts at, then every new size', async () => {
    const { api } = await start()
    const id = await startSession()

    await api.sessionHost.resize(id, { cols: 132, rows: 41 })

    await waitForText(id, 'Terminal resized to 132x41')
  })

  it('hosts claude in the ConPTY ClaudeForge ships (OpenConsole), not the older one built into Windows (conhost)', async () => {
    await start()
    await startSession()

    const children = await childProcessNames()

    expect(children).toContain('OpenConsole.exe')
    expect(children).not.toContain('conhost.exe')
  })

  it('ends every Hosted session when ClaudeForge closes', async () => {
    await start()
    await startSession()

    backend!.dispose()
    backend = undefined

    // The pseudoconsole host and `claude` (run through cmd.exe, as the fake is a batch file) are gone.
    await vi.waitFor(
      async () => {
        const children = await childProcessNames()
        expect(children).not.toContain('OpenConsole.exe')
        expect(children).not.toContain('cmd.exe')
      },
      { timeout: 15_000, interval: 500 }
    )
  })

  it('reports when claude exits, with its exit code', async () => {
    const { api } = await start()
    const id = await startSession()

    await api.sessionHost.write(id, '/exit\r')

    await vi.waitFor(() => expect(exits).toEqual([{ id, exitCode: 0 }]), { timeout: 15_000 })
  })

  it('reports a Hosted session working while claude answers the user, and done once it falls quiet', async () => {
    const { api } = await start()
    const working = await startSession('recipe-box')
    const other = await startSession('harbor-api')

    await api.sessionHost.write(working, '/work 1000\r')

    await vi.waitFor(() => expect(statuses(working)).toEqual(['working', 'done']), { timeout: 15_000 })
    expect(statuses(other)).toEqual([])
  })

  it('reports a Hosted session waiting while claude waits for the user, and done once the user answers', async () => {
    const { api } = await start()
    const id = await startSession()

    await api.sessionHost.write(id, '/ask\r')

    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting']), { timeout: 15_000 })
    await api.sessionHost.write(id, 'blue\r')
    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting', 'done']), { timeout: 15_000 })
  })

  it('reports a Hosted session waiting on a permission prompt too, and a failed turn as over', async () => {
    const { api } = await start()
    const id = await startSession()

    await api.sessionHost.write(id, '/permission\r')
    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting']), { timeout: 15_000 })
    await api.sessionHost.write(id, 'yes\r')
    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting', 'done']), { timeout: 15_000 })
    await api.sessionHost.write(id, '/fail\r')

    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting', 'done', 'working', 'done']), { timeout: 15_000 })
  })

  it('is back at rest once claude exits and clears its status', async () => {
    const { api } = await start()
    const id = await startSession()
    await api.sessionHost.write(id, '/ask\r')
    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting']), { timeout: 15_000 })

    await api.sessionHost.write(id, 'blue\r')
    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting', 'done']), { timeout: 15_000 })
    await api.sessionHost.write(id, '/exit\r')

    await vi.waitFor(() => expect(statuses(id)).toEqual(['waiting', 'done', 'idle']), { timeout: 15_000 })
    await vi.waitFor(() => expect(exits.map((exit) => exit.id)).toEqual([id]), { timeout: 15_000 })
  })

  it('tells when a turn ends, finished or interrupted by the user, with its Project', async () => {
    const { api } = await start()
    const turnEnds: Array<{ id: string; cwd: string }> = []
    backend!.on('sessionHost.turnEnded', (turnEnd) => turnEnds.push(turnEnd))
    const id = await startSession('harbor-api')

    await api.sessionHost.write(id, '/work 300\r')
    const cwd = env!.projects['harbor-api']
    await vi.waitFor(() => expect(turnEnds).toEqual([{ id, cwd }]), { timeout: 15_000 })
    await api.sessionHost.write(id, '/work 60000\r')
    await vi.waitFor(() => expect(statuses(id)).toEqual(['working', 'done', 'working']), { timeout: 15_000 })
    await api.sessionHost.write(id, 'x')

    await vi.waitFor(() => expect(statuses(id)).toEqual(['working', 'done', 'working', 'idle']), { timeout: 15_000 })
    expect(turnEnds).toHaveLength(2)
  })

  it('follows the Session history when claude sends no status signals, as before Claude Code 2.1.295', async () => {
    const { api } = await start({ claude: { version: '2.1.200' } })
    const turnEnds: string[] = []
    backend!.on('sessionHost.turnEnded', ({ id }) => turnEnds.push(id))
    const id = await startSession()

    await api.sessionHost.write(id, '/work 1500\r')

    await vi.waitFor(() => expect(statuses(id)).toEqual(['working', 'done']), { timeout: 15_000 })
    expect(turnEnds).toEqual([id])
  })

  it("follows a resumed Session's history from where it was, so its past turns say nothing", async () => {
    const { api } = await start({ claude: { version: '2.1.200' } })
    const { id } = await api.sessionHost.resume(PAST_SESSION, SIZE)
    await waitForText(id, `Terminal ${SIZE.cols}x${SIZE.rows}`)

    await api.sessionHost.write(id, '/work 1500\r')

    await vi.waitFor(() => expect(statuses(id)).toEqual(['working', 'done']), { timeout: 15_000 })
  })

  it("does not count claude echoing the user's typing as work", async () => {
    const { api } = await start()
    const id = await startSession()

    await api.sessionHost.write(id, 'hello')
    await waitForText(id, '> hello')
    await api.sessionHost.write(id, '\r')
    await waitForText(id, 'You wrote: "hello"')
    // Longer than a Session must stay quiet before it counts as done.
    await new Promise((resolve) => setTimeout(resolve, 2_500))

    expect(statuses(id)).toEqual([])
  })

  it('stops a Hosted session, and reports that its claude ended', async () => {
    const { api } = await start()
    const first = await startSession('recipe-box')
    const second = await startSession('harbor-api')

    await api.sessionHost.stop(first)

    await vi.waitFor(() => expect(exits.map(({ id }) => id)).toEqual([first]), { timeout: 15_000 })
    await api.sessionHost.write(second, 'still here\r')
    await waitForText(second, 'You wrote: "still here"')
  })
})
