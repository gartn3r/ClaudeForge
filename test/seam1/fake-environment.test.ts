import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'

const run = promisify(exec)

describe('the fake environment', () => {
  let env: FakeEnvironment | undefined

  afterEach(async () => {
    await env?.dispose()
    env = undefined
  })

  it('puts a fake claude on PATH that answers its version and records how it was called', async () => {
    env = await createFakeEnvironment()

    const { stdout } = await run('claude --version', { env: env.processEnv, cwd: env.projects['harbor-api'] })

    expect(stdout.trim()).toBe('2.1.300 (Claude Code)')
    expect(await env.invocations('claude')).toEqual([
      expect.objectContaining({ args: ['--version'], cwd: env.projects['harbor-api'] })
    ])
  })

  it('puts a fake gh on PATH that replays recorded JSON and refuses what it has no recording for', async () => {
    env = await createFakeEnvironment()

    const auth = await run('gh auth status', { env: env.processEnv })
    expect(auth.stdout).toContain('Logged in to github.com')

    const { stdout } = await run('gh api repos/fixture/harbor-api', { env: env.processEnv })
    expect(JSON.parse(stdout)).toMatchObject({ full_name: 'fixture/harbor-api' })

    await expect(run('gh api repos/fixture/unknown', { env: env.processEnv })).rejects.toThrow(/no recording/)
    expect((await env.invocations('gh')).map((call) => call.args)).toEqual([
      ['auth', 'status'],
      ['api', 'repos/fixture/harbor-api'],
      ['api', 'repos/fixture/unknown']
    ])
  })

  it('gives each fixture Project its Tracker declaration', async () => {
    env = await createFakeEnvironment()

    const github = await readFile(join(env.projects['harbor-api'], 'docs/agents/issue-tracker.md'), 'utf8')
    const local = await readFile(join(env.projects['recipe-box'], 'docs/agents/issue-tracker.md'), 'utf8')

    expect(github).toMatch(/GitHub/)
    expect(local).toMatch(/local markdown/i)
    expect(existsSync(join(env.projects['recipe-box'], '.scratch/meal-planner/map.md'))).toBe(true)
    expect(existsSync(join(env.projects.dotfiles, 'docs/agents/issue-tracker.md'))).toBe(false)
  })

  it('keeps a Claude Code home with a past Session for a fixture Project', async () => {
    env = await createFakeEnvironment()

    const folder = join(env.claudeHome, 'projects', env.projects['harbor-api'].replace(/[^a-zA-Z0-9]/g, '-'))
    const [file] = await readdir(folder)
    const first = JSON.parse((await readFile(join(folder, file!), 'utf8')).split('\n')[0]!)

    expect(first).toMatchObject({ type: 'user', cwd: env.projects['harbor-api'] })
    expect(env.processEnv.CLAUDE_CONFIG_DIR).toBe(env.claudeHome)
  })

  it('removes everything it created when disposed', async () => {
    env = await createFakeEnvironment()
    const { root } = env

    await env.dispose()
    env = undefined

    expect(existsSync(root)).toBe(false)
  })
})
