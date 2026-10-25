import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import { createFakeEnvironment, FAKE_CLAUDE_VERSION, type FakeEnvironment, type FakeEnvironmentOptions } from '../fake-env'
import { startBackend } from './backend'

describe('the Claude Code locator', () => {
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

  /** Starts the backend with the file dialog answering the given path, as if the user picked it. */
  const startPicking = (picked: () => string | undefined): Backend => {
    backend = startBackend(env!, undefined, { chooseClaudeExecutable: async () => picked() })
    return backend
  }

  it('finds claude on PATH and reads its version', async () => {
    const { api } = await start()

    expect(await api.claudeCode.locate()).toEqual({
      state: 'found',
      path: env!.claudePath,
      version: FAKE_CLAUDE_VERSION
    })
  })

  it('reports a claude older than the minimum supported version, with that minimum', async () => {
    const { api } = await start({ claude: { version: '1.0.44' } })

    expect(await api.claudeCode.locate()).toEqual({
      state: 'outdated',
      path: env!.claudePath,
      version: '1.0.44',
      minimumVersion: '2.1.0'
    })
  })

  it('reports claude missing when it is nowhere, with the places it looked in', async () => {
    const { api } = await start({ claude: false })

    expect(await api.claudeCode.locate()).toEqual({
      state: 'missing',
      lookedIn: ['PATH', '%USERPROFILE%\\.local\\bin', '%APPDATA%\\npm']
    })
  })

  it("finds claude in the native installer's folder, which PATH does not list until ClaudeForge restarts", async () => {
    const { api } = await start({ claude: { location: 'installer' } })

    expect(await api.claudeCode.locate()).toEqual({
      state: 'found',
      path: env!.claudePath,
      version: FAKE_CLAUDE_VERSION
    })
  })

  it('finds claude at the path the user chose, and remembers that path across a restart', async () => {
    env = await createFakeEnvironment({ claude: { location: 'elsewhere' } })
    const { api } = startPicking(() => env!.claudePath)
    const found = { state: 'found', path: env.claudePath, version: FAKE_CLAUDE_VERSION }

    expect((await api.claudeCode.locate()).state).toBe('missing')
    expect(await api.claudeCode.choose()).toEqual(found)
    expect((await api.appState.read()).claudePath).toBe(env.claudePath)

    backend!.dispose()
    backend = startBackend(env)
    expect(await backend.api.claudeCode.locate()).toEqual(found)
  })

  it('prefers the claude the user chose over an outdated one on PATH', async () => {
    env = await createFakeEnvironment({ claude: { version: '1.0.44' } })
    const chosen = await env.installClaude({ location: 'elsewhere', version: '2.2.0' })
    const { api } = startPicking(() => chosen)

    expect(await api.claudeCode.choose()).toEqual({ state: 'found', path: chosen, version: '2.2.0' })
  })

  it('changes nothing when the user cancels the file dialog', async () => {
    env = await createFakeEnvironment({ claude: false })
    const { api } = startPicking(() => undefined)

    expect((await api.claudeCode.choose()).state).toBe('missing')
    expect((await api.appState.read()).claudePath).toBeNull()
  })

  it('looks at the chosen path first, and says so when claude is no longer there', async () => {
    env = await createFakeEnvironment({ claude: false })
    const gone = join(env.root, 'Removed', 'claude.exe')
    const { api } = startPicking(() => gone)

    expect(await api.claudeCode.choose()).toEqual({
      state: 'missing',
      lookedIn: [gone, 'PATH', '%USERPROFILE%\\.local\\bin', '%APPDATA%\\npm']
    })
  })
})
