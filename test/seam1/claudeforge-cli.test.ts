import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import { CLI_INSTRUCTION } from '../../src/backend/cli-channel'
import { CONTENT_KINDS, CREATED_KINDS, PROPERTIES, type ElementView } from '../../src/shared/elements'
import { createFakeEnvironment, type FakeEnvironment, type FixtureProject } from '../fake-env'
import { startBackend } from './backend'

/** The `claudeforge` command as ClaudeForge ships it: its shims and the script they run. */
const CLI_FOLDER = resolve(__dirname, '../../cli')
const CLI_SCRIPT = join(CLI_FOLDER, 'claudeforge.mjs')

const SIZE = { cols: 120, rows: 40 }

/** Drops the escape sequences ConPTY wraps around text, leaving what reads on screen. */
const plain = (output: string): string =>
  // eslint-disable-next-line no-control-regex -- escape sequences start with ESC and may end with BEL
  output.replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, '')

interface Run {
  stdout: string
  stderr: string
  exitCode: number
}

/** Runs a program to its end, with what it printed and its exit code. */
const runProgram = (file: string, args: string[], options: { env: Record<string, string>; cwd: string; stdin?: string }): Promise<Run> =>
  new Promise((done) => {
    const child = execFile(file, args, { env: options.env, cwd: options.cwd, windowsHide: true }, (error, stdout, stderr) =>
      done({ stdout, stderr, exitCode: error ? Number(error.code ?? 1) : 0 })
    )
    child.stdin?.end(options.stdin ?? '')
  })

/** Git Bash, as Claude Code finds it from the git on PATH (`<Git>\cmd\git.exe` → `<Git>\bin\bash.exe`); undefined without one. */
function gitBash(): string | undefined {
  try {
    const gits = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
    const installs = gits.flatMap((git) => [dirname(dirname(git)), dirname(dirname(dirname(git)))])
    return installs.map((install) => join(install, 'bin', 'bash.exe')).find((bash) => existsSync(bash))
  } catch {
    return undefined
  }
}

describe('the ClaudeForge CLI', () => {
  let env: FakeEnvironment | undefined
  let backend: Backend | undefined
  /** Everything each Hosted session has printed so far, by id. */
  let outputs: Map<string, string>

  afterEach(async () => {
    backend?.dispose()
    await env?.dispose()
  })

  const start = async (): Promise<Backend> => {
    env = await createFakeEnvironment()
    backend = startBackend(env, undefined, undefined, undefined, undefined, { folder: CLI_FOLDER, runtime: process.execPath })
    outputs = new Map()
    backend.on('sessionHost.output', ({ id, data }) => outputs.set(id, (outputs.get(id) ?? '') + data))
    return backend
  }

  const output = (id: string): string => plain(outputs.get(id) ?? '')

  const waitForText = (id: string, text: string): Promise<void> =>
    vi.waitFor(() => expect(output(id)).toContain(text), { timeout: 15_000, interval: 50 })

  /** A Hosted session as its Bash sees it: its id, its folder, and the variables ClaudeForge gave its `claude`. */
  interface Hosted {
    id: string
    sessionId: string
    folder: string
    variables: Record<string, string>
  }

  /** Starts a Session in a fixture Project, as the user does, and waits for the fake `claude` to show its prompt. */
  const hostSession = async (project: FixtureProject = 'recipe-box'): Promise<Hosted> => {
    const folder = env!.projects[project]
    const { id, sessionId } = await backend!.api.sessionHost.start(folder, SIZE)
    await waitForText(id, 'Fake Claude Code')
    const run = (await env!.invocations('claude')).find(({ args }) => args.includes(sessionId))!
    const variables = Object.fromEntries(Object.entries(run.env).filter(([name]) => name.startsWith('CLAUDEFORGE_CLI_')))
    return { id, sessionId, folder, variables }
  }

  /** Runs `claudeforge` as a Hosted session's Bash would, with the variables its `claude` got, or as another program would. */
  const claudeforge = (
    args: string[],
    { as, cwd, stdin }: { as?: Hosted | Record<string, string>; cwd?: string; stdin?: string } = {}
  ): Promise<Run> => {
    const variables = as && 'variables' in as ? (as.variables as Record<string, string>) : (as ?? {})
    const folder = cwd ?? (as && 'folder' in as ? (as.folder as string) : env!.projects['recipe-box'])
    return runProgram(process.execPath, [CLI_SCRIPT, ...args], { env: { ...env!.processEnv, ...variables }, cwd: folder, stdin })
  }

  /** The Elements of a Project, as the interface reads them. */
  const elementsOf = async (project: FixtureProject): Promise<ElementView[]> => {
    const result = await backend!.api.elements.request({ op: 'list', project: env!.projects[project] })
    if (!result.ok) throw new Error(result.refusal.code)
    return result.elements
  }

  const elementOf = async (project: FixtureProject, id: string): Promise<ElementView | undefined> =>
    (await elementsOf(project)).find((element) => element.id === id)

  describe('reaching ClaudeForge', () => {
    it("is within reach of a Hosted session's Claude, and `claudeforge list` names the Elements with their identifiers", async () => {
      await start()
      const { id } = await hostSession()

      // Through cmd.exe, as Claude Code's bash mode would run it on PATH.
      await backend!.api.sessionHost.write(id, '!claudeforge list\r')

      await waitForText(id, 'panel-tab:map')
      for (const element of ['title-bar', 'explorer', 'shortcuts', 'sessions', 'extensions', 'terminal-area', 'right-panel'])
        expect(output(id)).toContain(element)
    })

    it("runs from Git Bash too, where Claude Code's Bash tool runs commands on Windows", async (context) => {
      const bash = gitBash()
      if (!bash) return context.skip()
      await start()
      const hosted = await hostSession()
      const path = `${CLI_FOLDER}${delimiter}${env!.processEnv.PATH}`

      const run = await runProgram(bash, ['-c', 'claudeforge list'], {
        env: { ...env!.processEnv, ...hosted.variables, PATH: path },
        cwd: hosted.folder
      })

      expect(run).toMatchObject({ exitCode: 0, stderr: '' })
      expect(run.stdout).toContain('panel-tab:map')
    })

    it('is told to each Hosted session, in one line that a claude.cmd install passes on as it is', async () => {
      await start()
      expect(env!.claudePath).toMatch(/\.cmd$/)

      const { sessionId } = await hostSession()
      const resumed = await backend!.api.sessionHost.resume('5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', SIZE)
      await waitForText(resumed.id, 'Fake Claude Code')

      const runs = (await env!.invocations('claude')).filter(({ args }) => args[0] !== '--version')
      expect(runs.map(({ args }) => args)).toEqual([
        ['--session-id', sessionId, '--append-system-prompt', CLI_INSTRUCTION],
        ['--resume', '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', '--append-system-prompt', CLI_INSTRUCTION]
      ])
      expect(CLI_INSTRUCTION).toContain('claudeforge --help')
      expect(CLI_INSTRUCTION).not.toMatch(/["%\r\n]/)
    })

    it('refuses an External session or another terminal, which ClaudeForge gave nothing to reach it', async () => {
      await start()
      await hostSession()

      const run = await claudeforge(['list'])

      expect(run).toEqual({ stdout: '', stderr: 'claudeforge: Only a Session running in ClaudeForge can change its interface.\n', exitCode: 1 })
    })

    it('refuses another terminal that finds the command but is not a Hosted session, even through its shim', async () => {
      await start()
      await hostSession()
      const path = `${CLI_FOLDER}${delimiter}${env!.processEnv.PATH}`

      const run = await runProgram(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'claudeforge list'], {
        env: { ...env!.processEnv, PATH: path },
        cwd: env!.projects['recipe-box']
      })

      expect(run.exitCode).toBe(1)
      expect(run.stderr).toContain('Only a Session running in ClaudeForge can change its interface.')
    })

    it('refuses a program that reaches the channel without the identity of a running Hosted session', async () => {
      await start()
      const hosted = await hostSession()
      const channel = hosted.variables.CLAUDEFORGE_CLI_CHANNEL!

      const strangers = [
        { CLAUDEFORGE_CLI_CHANNEL: channel, CLAUDEFORGE_CLI_TOKEN: 'not-a-token' },
        { CLAUDEFORGE_CLI_CHANNEL: channel, CLAUDEFORGE_CLI_TOKEN: hosted.variables.CLAUDEFORGE_CLI_TOKEN!.slice(0, -1) }
      ]
      for (const stranger of strangers) {
        const run = await claudeforge(['list'], { as: stranger })
        expect(run).toEqual({ stdout: '', stderr: 'claudeforge: Only a Session running in ClaudeForge can change its interface.\n', exitCode: 1 })
      }
    })

    it('refuses a Hosted session once its claude has ended', async () => {
      await start()
      const hosted = await hostSession()
      expect((await claudeforge(['list'], { as: hosted })).exitCode).toBe(0)

      const ended = new Promise<void>((done) => backend!.on('sessionHost.exit', () => done()))
      await backend!.api.sessionHost.stop(hosted.id)
      await ended

      const run = await claudeforge(['list'], { as: hosted })
      expect(run).toMatchObject({ stdout: '', exitCode: 1 })
      expect(run.stderr).toContain('Only a Session running in ClaudeForge')
    })

    it('says so when ClaudeForge has closed', async () => {
      await start()
      const hosted = await hostSession()
      backend!.dispose()
      backend = undefined

      const run = await claudeforge(['list'], { as: hosted })

      expect(run).toMatchObject({ stdout: '', exitCode: 1 })
      expect(run.stderr).toContain('ClaudeForge cannot be reached')
    })
  })

  describe('commands', () => {
    it('creates a Panel tab, a card and a menu in its Project, each brought to the front and named by its identifier', async () => {
      await start()
      const hosted = await hostSession()

      const created = [
        await claudeforge(['create', 'panel-tab:tests', '--title', 'Tests'], { as: hosted }),
        await claudeforge(['create', 'card:release'], { as: hosted }),
        await claudeforge(['create', 'menu:tests'], { as: hosted })
      ]

      expect(created.map(({ stdout, exitCode }) => ({ stdout, exitCode }))).toEqual([
        { stdout: 'Created panel-tab:tests.\n', exitCode: 0 },
        { stdout: 'Created card:release.\n', exitCode: 0 },
        { stdout: 'Created menu:tests.\n', exitCode: 0 }
      ])
      const elements = await elementsOf('recipe-box')
      expect(elements.filter(({ project }) => project !== null)).toEqual([
        expect.objectContaining({ id: 'panel-tab:tests', kind: 'panel-tab', attention: 'front', properties: expect.objectContaining({ title: 'Tests' }) }),
        expect.objectContaining({ id: 'card:release', kind: 'card', attention: 'front' }),
        expect.objectContaining({ id: 'menu:tests', kind: 'menu', attention: 'front' })
      ])
      expect((await elementsOf('harbor-api')).filter(({ project }) => project !== null)).toEqual([])
      // And `list` names them too.
      const listed = await claudeforge(['list'], { as: hosted })
      for (const id of ['panel-tab:tests', 'card:release', 'menu:tests']) expect(listed.stdout).toContain(id)
    })

    it('sets each of the seven properties, an empty value giving back the default', async () => {
      await start()
      const hosted = await hostSession()
      await claudeforge(['create', 'card:release'], { as: hosted })

      const card = await claudeforge(
        ['set', 'card:release', 'visible=false', 'collapsed=true', 'order=7', 'title=Release notes', 'textColor=#112233', 'backgroundColor=oklch(0.9 0.05 90)'],
        { as: hosted }
      )
      const explorer = await claudeforge(['set', 'explorer', 'width=300'], { as: hosted })
      const reset = await claudeforge(['set', 'card:release', 'textColor='], { as: hosted })

      expect([card, explorer, reset].map(({ exitCode }) => exitCode)).toEqual([0, 0, 0])
      expect(card.stdout).toBe('Set visible, collapsed, order, title, textColor, backgroundColor on card:release.\n')
      expect((await elementOf('recipe-box', 'card:release'))!.properties).toEqual({
        visible: false,
        collapsed: true,
        order: 7,
        title: 'Release notes',
        textColor: null,
        backgroundColor: 'oklch(0.9 0.05 90)'
      })
      expect((await elementOf('recipe-box', 'explorer'))!.properties.width).toBe(300)
    })

    it('refuses a property an Element does not take, or a value it cannot hold, with a clear message and nothing changed', async () => {
      await start()
      const hosted = await hostSession()
      await claudeforge(['create', 'menu:tests'], { as: hosted })

      const notTaken = await claudeforge(['set', 'menu:tests', 'title=Tests', 'collapsed=true'], { as: hosted })
      const badValue = await claudeforge(['set', 'menu:tests', 'order=first'], { as: hosted })
      const unknown = await claudeforge(['set', 'menu:tests', 'colour=red'], { as: hosted })

      expect(notTaken).toEqual({
        stdout: '',
        stderr: 'claudeforge: menu:tests takes visible, order, title, textColor, backgroundColor only, not collapsed.\n',
        exitCode: 1
      })
      expect(badValue).toMatchObject({ stderr: 'claudeforge: order is a whole number from -999 to 999.\n', exitCode: 1 })
      expect(unknown.stderr).toContain('colour is not a property')
      expect((await elementOf('recipe-box', 'menu:tests'))!.properties.title).toBe('tests')
    })

    it('adds each kind of Content item, replacing one under an identifier already used, and names it', async () => {
      await start()
      const hosted = await hostSession()
      await claudeforge(['create', 'panel-tab:tests'], { as: hosted })
      await mkdir(join(hosted.folder, 'reports'), { recursive: true })
      await writeFile(join(hosted.folder, 'reports', 'coverage.md'), '# Coverage\n')

      const added = [
        await claudeforge(['add', 'panel-tab:tests', '--id', 'summary', '--text', '# 12 passed'], { as: hosted }),
        await claudeforge(['add', 'panel-tab:tests', '--id', 'ci', '--link', 'https://ci.example/run/1', '--title', 'CI run'], { as: hosted }),
        await claudeforge(['add', 'panel-tab:tests', '--id', 'coverage', '--file', 'reports/coverage.md'], { as: hosted }),
        await claudeforge(['add', 'panel-tab:tests', '--id', 'app', '--web-page', 'http://localhost:5173/'], { as: hosted }),
        await claudeforge(['add', 'panel-tab:tests', '--id', 'rerun', '--action', 'npm test', '--title', 'Run the tests again'], { as: hosted }),
        await claudeforge(['add', 'panel-tab:tests', '--id', 'summary', '--text', '-'], { as: hosted, stdin: '# 13 passed\n\nAll green.\n' })
      ]

      expect(added.map(({ stdout }) => stdout)).toEqual([
        'Added summary to panel-tab:tests.\n',
        'Added ci to panel-tab:tests.\n',
        'Added coverage to panel-tab:tests.\n',
        'Added app to panel-tab:tests.\n',
        'Added rerun to panel-tab:tests.\n',
        'Replaced summary in panel-tab:tests.\n'
      ])
      const writtenBy = { kind: 'session', sessionId: hosted.sessionId }
      expect((await elementOf('recipe-box', 'panel-tab:tests'))!.items).toEqual([
        { id: 'summary', kind: 'text', text: '# 13 passed\n\nAll green.\n', writtenBy },
        { id: 'ci', kind: 'link', title: 'CI run', address: 'https://ci.example/run/1', writtenBy },
        expect.objectContaining({ id: 'coverage', kind: 'file', path: join(hosted.folder, 'reports', 'coverage.md'), writtenBy }),
        { id: 'app', kind: 'web-page', address: 'http://localhost:5173/', writtenBy },
        { id: 'rerun', kind: 'action', title: 'Run the tests again', command: 'npm test', writtenBy }
      ])
    })

    it('gives an id to a Content item added without one, and leaves a mark unless asked to show the Element', async () => {
      await start()
      const hosted = await hostSession()
      await claudeforge(['create', 'card:release'], { as: hosted })
      await backend!.api.elements.request({ op: 'seen', project: hosted.folder, element: 'card:release' })

      const added = await claudeforge(['add', 'card:release', '--link', 'https://example.com/notes'], { as: hosted })
      const { items, attention } = (await elementOf('recipe-box', 'card:release'))!
      expect(added.stdout).toBe(`Added ${items[0]!.id} to card:release.\n`)
      expect(attention).toBe('mark')

      await claudeforge(['add', 'card:release', '--action', 'npm run release', '--show'], { as: hosted })
      expect((await elementOf('recipe-box', 'card:release'))!.attention).toBe('front')
    })

    it('refuses a kind of Content item an Element does not take, with a clear message', async () => {
      await start()
      const hosted = await hostSession()
      await claudeforge(['create', 'card:release'], { as: hosted })
      await claudeforge(['create', 'menu:tests'], { as: hosted })

      const intoCard = await claudeforge(['add', 'card:release', '--web-page', 'http://localhost:5173/'], { as: hosted })
      const intoMenu = await claudeforge(['add', 'menu:tests', '--text', 'Hello'], { as: hosted })
      const intoOwn = await claudeforge(['add', 'shortcuts', '--link', 'https://example.com/'], { as: hosted })

      expect(intoCard).toEqual({
        stdout: '',
        stderr: 'claudeforge: card:release takes text, link, file, action only, not web-page.\n',
        exitCode: 1
      })
      expect(intoMenu.stderr).toBe('claudeforge: menu:tests takes link, action only, not text.\n')
      expect(intoOwn.stderr).toBe('claudeforge: shortcuts takes no Content item, not link.\n')
    })

    it('removes a Content item and closes a created Element', async () => {
      await start()
      const hosted = await hostSession()
      await claudeforge(['create', 'panel-tab:tests'], { as: hosted })
      await claudeforge(['add', 'panel-tab:tests', '--id', 'summary', '--text', 'Done'], { as: hosted })

      const removed = await claudeforge(['remove', 'panel-tab:tests', 'summary'], { as: hosted })
      expect(removed.stdout).toBe('Removed summary from panel-tab:tests.\n')
      expect((await elementOf('recipe-box', 'panel-tab:tests'))!.items).toEqual([])

      const closed = await claudeforge(['close', 'panel-tab:tests'], { as: hosted })
      expect(closed.stdout).toBe('Closed panel-tab:tests.\n')
      expect(await elementOf('recipe-box', 'panel-tab:tests')).toBeUndefined()

      const own = await claudeforge(['close', 'explorer'], { as: hosted })
      expect(own).toMatchObject({ stderr: "claudeforge: explorer is ClaudeForge's own: it can be hidden, not closed.\n", exitCode: 1 })
    })

    it("refuses another Project's Created Elements", async () => {
      await start()
      const harbor = await hostSession('harbor-api')
      await claudeforge(['create', 'card:release'], { as: harbor })
      const recipe = await hostSession('recipe-box')

      const named = await claudeforge(['set', 'card:release', 'title=Mine', '--project', harbor.folder], { as: recipe })
      const unnamed = await claudeforge(['close', 'card:release'], { as: recipe })

      expect(named).toEqual({
        stdout: '',
        stderr: `claudeforge: This Session belongs to ${recipe.folder}: it cannot change the Elements of ${harbor.folder}.\n`,
        exitCode: 1
      })
      expect(unnamed.stderr).toBe('claudeforge: There is no Element card:release.\n')
      expect(await elementOf('harbor-api', 'card:release')).toMatchObject({ properties: expect.objectContaining({ title: 'release' }) })
    })

    it('documents every command, property and kind of content in claudeforge --help', async () => {
      await start()
      const hosted = await hostSession()

      const help = await claudeforge(['--help'], { as: hosted })

      expect(help).toMatchObject({ stderr: '', exitCode: 0 })
      for (const command of ['list', 'create', 'close', 'set', 'add', 'remove'])
        expect(help.stdout).toMatch(new RegExp(`^  ${command}\\b`, 'm'))
      for (const name of [...PROPERTIES, ...CREATED_KINDS]) expect(help.stdout).toContain(name)
      for (const kind of CONTENT_KINDS) expect(help.stdout).toContain(`--${kind}`)
      expect((await claudeforge(['add', '--help'], { as: hosted })).stdout).toBe(help.stdout)
      expect((await claudeforge([], { as: hosted })).stdout).toBe(help.stdout)
    })

    it('answers a command it does not know, or one used wrongly, with what to run instead', async () => {
      await start()
      const hosted = await hostSession()

      const unknown = await claudeforge(['show', 'panel-tab:tests'], { as: hosted })
      const twoKinds = await claudeforge(['add', 'panel-tab:tests', '--text', 'a', '--link', 'https://example.com/'], { as: hosted })
      const noKind = await claudeforge(['create', 'tests'], { as: hosted })

      for (const run of [unknown, twoKinds, noKind]) {
        expect(run).toMatchObject({ stdout: '', exitCode: 2 })
        expect(run.stderr).toMatch(/^claudeforge: .+\nRun claudeforge --help to see the commands\.\n$/)
      }
      expect(unknown.stderr).toContain('show is not a command')
    })
  })
})
