import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import { createFakeEnvironment, type FakeEnvironment, type FakeEnvironmentOptions } from '../fake-env'
import { startBackend } from './backend'

/** Drops the escape sequences ConPTY wraps around text, leaving what reads on screen. */
const plain = (output: string): string =>
  // eslint-disable-next-line no-control-regex -- escape sequences start with ESC and may end with BEL
  output.replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, '')

describe('the Session host', () => {
  let env: FakeEnvironment | undefined
  let backend: Backend | undefined

  afterEach(async () => {
    backend?.dispose()
    await env?.dispose()
  })

  const start = async (options?: FakeEnvironmentOptions): Promise<Backend> => {
    env = await createFakeEnvironment(options)
    backend = startBackend(env)
    return backend
  }

  /** Everything each Hosted session has printed so far, by id, as plain text. */
  const recordOutput = (from: Backend): ((id: string) => string) => {
    const outputs = new Map<string, string>()
    from.on('sessionHost.output', ({ id, data }) => outputs.set(id, (outputs.get(id) ?? '') + data))
    return (id) => plain(outputs.get(id) ?? '')
  }

  const waitForText = (output: () => string, text: string): Promise<void> =>
    vi.waitFor(() => expect(output()).toContain(text), { timeout: 15_000, interval: 50 })

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

    await expect(api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })).rejects.toThrow()
  })

  it('starts claude with no options in the Project, with the environment ConPTY hosts need, and streams its output', async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const project = env!.projects['recipe-box']

    const session = await api.sessionHost.start(project, { cols: 100, rows: 30 })

    expect(session.project).toBe(project)
    await waitForText(() => output(session.id), 'Fake Claude Code')
    expect(await sessionRuns()).toEqual([
      {
        args: [],
        cwd: project,
        env: expect.objectContaining({ CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1', TERM_PROGRAM: 'ClaudeForge' })
      }
    ])
  })

  it('types into the Hosted session, and claude answers in its output', async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const { id } = await api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })
    await waitForText(() => output(id), 'Terminal 100x30')

    await api.sessionHost.write(id, 'hello\r')

    await waitForText(() => output(id), 'You wrote: "hello"')
  })

  it('gives claude the terminal size it starts at, then every new size', async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const { id } = await api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })
    await waitForText(() => output(id), 'Terminal 100x30')

    await api.sessionHost.resize(id, { cols: 132, rows: 41 })

    await waitForText(() => output(id), 'Terminal resized to 132x41')
  })

  /** The names of the processes this test process started (other than the query itself), as Windows lists them. */
  const childProcessNames = (): string[] =>
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND ProcessId<>$PID" | ForEach-Object Name`
      ],
      { encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean)

  it("hosts claude in the ConPTY ClaudeForge ships (OpenConsole), not the older one built into Windows (conhost)", async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const { id } = await api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })
    await waitForText(() => output(id), 'Terminal 100x30')

    const children = childProcessNames()

    expect(children).toContain('OpenConsole.exe')
    expect(children).not.toContain('conhost.exe')
  })

  it('ends every Hosted session when ClaudeForge closes', async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const { id } = await api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })
    await waitForText(() => output(id), 'Terminal 100x30')

    backend!.dispose()
    backend = undefined

    await vi.waitFor(() => expect(childProcessNames()).toEqual([]), { timeout: 15_000, interval: 500 })
  })

  /** The exit events of the Hosted sessions, oldest first. */
  const recordExits = (from: Backend): Array<{ id: string; exitCode: number }> => {
    const exits: Array<{ id: string; exitCode: number }> = []
    from.on('sessionHost.exit', (exit) => exits.push(exit))
    return exits
  }

  it('reports when claude exits, with its exit code', async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const exits = recordExits(backend!)
    const { id } = await api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })
    await waitForText(() => output(id), 'Terminal 100x30')

    await api.sessionHost.write(id, '/exit\r')

    await vi.waitFor(() => expect(exits).toEqual([{ id, exitCode: 0 }]), { timeout: 15_000 })
  })

  it('stops a Hosted session, and reports that its claude ended', async () => {
    const { api } = await start()
    const output = recordOutput(backend!)
    const exits = recordExits(backend!)
    const first = await api.sessionHost.start(env!.projects['recipe-box'], { cols: 100, rows: 30 })
    const second = await api.sessionHost.start(env!.projects['harbor-api'], { cols: 100, rows: 30 })
    await waitForText(() => output(first.id), 'Terminal 100x30')

    await api.sessionHost.stop(first.id)

    await vi.waitFor(() => expect(exits.map(({ id }) => id)).toEqual([first.id]), { timeout: 15_000 })
    await api.sessionHost.write(second.id, 'still here\r')
    await waitForText(() => output(second.id), 'You wrote: "still here"')
  })
})
