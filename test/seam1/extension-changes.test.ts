import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import type { Extension } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

describe('Extension changes, through Claude Code’s CLI', () => {
  let env: FakeEnvironment
  let backend: Backend

  beforeEach(async () => {
    env = await createFakeEnvironment()
    backend = startBackend(env)
  })

  afterEach(async () => {
    backend.dispose()
    await env.dispose()
  })

  /** The `claude mcp …` and `claude plugin …` commands that changed something, and the folder each ran in. */
  const changes = async (): Promise<string[]> =>
    (await env.invocations('claude'))
      .filter(({ args }) => ['mcp', 'plugin'].includes(args[0]!) && args[1] !== 'list')
      .map(({ args, cwd }) => `${args.join(' ')} @ ${cwd}`)

  const find = async (project: string, kind: Extension['kind'], name: string): Promise<Extension | undefined> =>
    (await backend.api.extensions.list(project)).extensions.find(
      (extension) => extension.kind === kind && extension.name === name
    )

  describe('plugins', () => {
    it('disables a global plugin with `claude plugin disable … -s user`, in the Project’s folder', async () => {
      const project = env.projects['recipe-box']

      const result = await backend.api.extensions.change(project, {
        action: 'disable-plugin',
        plugin: { id: 'kitchen-tools@forge-market', scope: 'user' }
      })

      expect(result).toEqual({ ok: true })
      expect(await changes()).toEqual([`plugin disable kitchen-tools@forge-market -s user @ ${project}`])
      expect(await find(project, 'plugin', 'kitchen-tools')).toMatchObject({ enabled: false })
    })

    it('enables a disabled plugin with `claude plugin enable`', async () => {
      const project = env.projects.dotfiles
      const atlas = await find(project, 'plugin', 'atlas')

      await backend.api.extensions.change(project, { action: 'enable-plugin', plugin: atlas!.install! })

      expect(await changes()).toEqual([`plugin enable atlas@forge-market -s user @ ${project}`])
      expect(await find(project, 'plugin', 'atlas')).toMatchObject({ enabled: true })
    })

    it('switches a Project’s plugin at the scope Claude Code installed it in', async () => {
      const project = env.projects['recipe-box']
      const frontendDesign = await find(project, 'plugin', 'frontend-design')

      expect(frontendDesign?.install).toEqual({ id: 'frontend-design@forge-market', scope: 'project' })
      await backend.api.extensions.change(project, { action: 'disable-plugin', plugin: frontendDesign!.install! })

      expect(await changes()).toEqual([`plugin disable frontend-design@forge-market -s project @ ${project}`])
      expect(await find(project, 'plugin', 'frontend-design')).toMatchObject({ enabled: false })
      expect((await backend.api.extensions.list(project)).extensions).not.toContainEqual(
        expect.objectContaining({ plugin: 'frontend-design' })
      )
    })

    it('uninstalls a plugin with `claude plugin uninstall`, so it is listed no more', async () => {
      const project = env.projects['recipe-box']

      const result = await backend.api.extensions.change(project, {
        action: 'uninstall-plugin',
        plugin: { id: 'atlas@forge-market', scope: 'user' }
      })

      expect(result).toEqual({ ok: true })
      expect(await changes()).toEqual([`plugin uninstall atlas@forge-market -s user @ ${project}`])
      expect(await find(project, 'plugin', 'atlas')).toBeUndefined()
    })

    it('lists the marketplaces’ plugins not installed here yet, the most installed first', async () => {
      const listing = await backend.api.extensions.available(env.projects.dotfiles)

      expect(listing).toEqual({
        plugins: [
          {
            id: 'pastry-kit@forge-market',
            name: 'pastry-kit',
            description: 'Recipes and timers for baking.',
            marketplace: 'forge-market'
          },
          expect.objectContaining({ id: 'frontend-design@forge-market' }),
          expect.objectContaining({ id: 'sentry-tools@ops-market', marketplace: 'ops-market' })
        ]
      })
    })

    it('installs a marketplace plugin for the user with `claude plugin install … -s user`', async () => {
      const project = env.projects.dotfiles

      const result = await backend.api.extensions.change(project, {
        action: 'install-plugin',
        plugin: 'pastry-kit@forge-market',
        scope: 'global'
      })

      expect(result).toEqual({ ok: true })
      expect(await changes()).toEqual([`plugin install pastry-kit@forge-market -s user @ ${project}`])
      expect(await find(env.projects['recipe-box'], 'plugin', 'pastry-kit')).toEqual({
        kind: 'plugin',
        name: 'pastry-kit',
        scope: 'global',
        plugin: null,
        description: 'Recipes and timers for baking.',
        enabled: true,
        install: { id: 'pastry-kit@forge-market', scope: 'user' }
      })
    })

    it('installs a plugin for the Project as the user’s own there, with `-s local`, leaving the repository’s settings alone', async () => {
      const project = env.projects.dotfiles

      await backend.api.extensions.change(project, { action: 'install-plugin', plugin: 'pastry-kit@forge-market', scope: 'project' })

      expect(await changes()).toEqual([`plugin install pastry-kit@forge-market -s local @ ${project}`])
      expect(await find(project, 'plugin', 'pastry-kit')).toMatchObject({
        scope: 'project',
        install: { id: 'pastry-kit@forge-market', scope: 'local' }
      })
      expect(await find(env.projects['recipe-box'], 'plugin', 'pastry-kit')).toBeUndefined()
    })

    it('gives Claude Code’s own words when it refuses a change', async () => {
      const result = await backend.api.extensions.change(env.projects.dotfiles, {
        action: 'disable-plugin',
        plugin: { id: 'frontend-design@forge-market', scope: 'project' }
      })

      expect(result).toEqual({ ok: false, error: 'Plugin "frontend-design@forge-market" is not installed in project scope.' })
    })

    it('reports a failed install in Claude Code’s words, installing nothing', async () => {
      const project = env.projects.dotfiles

      const result = await backend.api.extensions.change(project, {
        action: 'install-plugin',
        plugin: 'sentry-tools@ops-market',
        scope: 'global'
      })

      expect(result).toEqual({
        ok: false,
        error: 'Failed to install plugin "sentry-tools@ops-market": could not reach https://git.ops.example/plugins.git'
      })
      expect(await find(project, 'plugin', 'sentry-tools')).toBeUndefined()
    })
  })

  describe('MCP servers', () => {
    it('adds a command server for the user with `claude mcp add -s user`, its variables before the command', async () => {
      const project = env.projects['recipe-box']

      const result = await backend.api.extensions.change(project, {
        action: 'add-mcp-server',
        scope: 'global',
        server: {
          name: 'notes',
          transport: 'stdio',
          target: 'npx',
          args: ['-y', 'notes-mcp'],
          env: ['NOTES_DIR=C:\\Notes', 'LOG=1'],
          headers: []
        }
      })

      expect(result).toEqual({ ok: true })
      expect(await changes()).toEqual([
        `mcp add -s user -t stdio notes -e NOTES_DIR=C:\\Notes -e LOG=1 -- npx -y notes-mcp @ ${project}`
      ])
      expect(await find(env.projects.dotfiles, 'mcp-server', 'notes')).toMatchObject({
        scope: 'global',
        mcp: { status: 'connected', detail: 'Connected' }
      })
    })

    it('adds a server for the Project as the user’s own there, with `-s local`', async () => {
      const project = env.projects.dotfiles

      await backend.api.extensions.change(project, {
        action: 'add-mcp-server',
        scope: 'project',
        server: { name: 'shell', transport: 'stdio', target: 'node', args: ['shell-mcp.mjs'], env: [], headers: [] }
      })

      expect(await changes()).toEqual([`mcp add -s local -t stdio shell -- node shell-mcp.mjs @ ${project}`])
      expect(await find(project, 'mcp-server', 'shell')).toMatchObject({ scope: 'project' })
      expect(await find(env.projects['recipe-box'], 'mcp-server', 'shell')).toBeUndefined()
    })

    it('adds a remote server with its URL and headers, each passed whole to Claude Code', async () => {
      const project = env.projects.dotfiles

      await backend.api.extensions.change(project, {
        action: 'add-mcp-server',
        scope: 'global',
        server: {
          name: 'Team Wiki',
          transport: 'http',
          target: 'https://wiki.example/mcp?space=a&b',
          args: [],
          env: [],
          headers: ['Authorization: Bearer "s3cr&t" | ^%PATH%!', 'X-Team: kitchen']
        }
      })

      const [invocation] = (await env.invocations('claude')).filter(({ args }) => args[1] === 'add')
      expect(invocation?.args).toEqual([
        'mcp',
        'add',
        '-s',
        'user',
        '-t',
        'http',
        'Team Wiki',
        'https://wiki.example/mcp?space=a&b',
        '-H',
        'Authorization: Bearer "s3cr&t" | ^%PATH%!',
        '-H',
        'X-Team: kitchen'
      ])
      expect(await find(project, 'mcp-server', 'Team Wiki')).toMatchObject({ scope: 'global' })
    })

    it('removes the user’s server with `claude mcp remove … -s user`', async () => {
      const project = env.projects.dotfiles

      const result = await backend.api.extensions.change(project, { action: 'remove-mcp-server', name: 'github', scope: 'global' })

      expect(result).toEqual({ ok: true })
      expect(await changes()).toEqual([`mcp remove github -s user @ ${project}`])
      expect(await find(project, 'mcp-server', 'github')).toBeUndefined()
    })

    it('removes the user’s own server in the Project with `-s local`', async () => {
      const project = env.projects['recipe-box']

      await backend.api.extensions.change(project, { action: 'remove-mcp-server', name: 'playwright', scope: 'project' })

      expect(await changes()).toEqual([`mcp remove playwright -s local @ ${project}`])
      expect(await find(project, 'mcp-server', 'playwright')).toBeUndefined()
    })

    it('removes a server the Project shares in its .mcp.json with `-s project`, once Claude Code finds none of the user’s own', async () => {
      const project = env.projects['harbor-api']

      const result = await backend.api.extensions.change(project, { action: 'remove-mcp-server', name: 'sentry', scope: 'project' })

      expect(result).toEqual({ ok: true })
      expect(await changes()).toEqual([`mcp remove sentry -s local @ ${project}`, `mcp remove sentry -s project @ ${project}`])
      expect(await find(project, 'mcp-server', 'sentry')).toBeUndefined()
    })

    it('reports Claude Code’s words when a server of that name is already there', async () => {
      const result = await backend.api.extensions.change(env.projects.dotfiles, {
        action: 'add-mcp-server',
        scope: 'global',
        server: { name: 'github', transport: 'stdio', target: 'npx', args: [], env: [], headers: [] }
      })

      expect(result).toEqual({ ok: false, error: 'MCP server github already exists in user config' })
    })

    it('marks the servers `claude mcp` cannot remove: a claude.ai connector, and a plugin’s', async () => {
      const servers = (await backend.api.extensions.list(env.projects.dotfiles)).extensions.filter(
        ({ kind }) => kind === 'mcp-server'
      )

      expect(servers.map(({ name, removable }) => [name, removable])).toEqual([
        ['claude.ai Supabase', false],
        ['github', true],
        ['pantry', false]
      ])
    })
  })

  describe('the open Sessions still using the previous setup', () => {
    const SIZE = { cols: 80, rows: 24 }

    const outdated = async (project = env.projects.dotfiles): Promise<string[]> =>
      (await backend.api.extensions.list(project)).outdatedSessions

    const disableKitchenTools = (project: string) =>
      backend.api.extensions.change(project, {
        action: 'disable-plugin',
        plugin: { id: 'kitchen-tools@forge-market', scope: 'user' }
      })

    it('are none before any change', async () => {
      await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)

      expect(await outdated()).toEqual([])
    })

    it('are every Hosted session started before a global change, in any Project, and none started after it', async () => {
      const before = await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)
      const elsewhere = await backend.api.sessionHost.start(env.projects['harbor-api'], SIZE)

      await disableKitchenTools(env.projects['recipe-box'])
      await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)

      expect((await outdated()).sort()).toEqual([before.id, elsewhere.id].sort())
    })

    it('are only the Project’s own Hosted sessions after a change to the Project', async () => {
      const inProject = await backend.api.sessionHost.start(env.projects.dotfiles, SIZE)
      await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)

      await backend.api.extensions.change(env.projects.dotfiles, {
        action: 'add-mcp-server',
        scope: 'project',
        server: { name: 'shell', transport: 'stdio', target: 'node', args: [], env: [], headers: [] }
      })

      expect(await outdated()).toEqual([inProject.id])
    })

    it('leave out a Hosted session once it ends', async () => {
      const session = await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)
      await disableKitchenTools(env.projects['recipe-box'])
      const ended = new Promise((resolve) => backend.on('sessionHost.exit', resolve))

      await backend.api.sessionHost.stop(session.id)
      await ended

      expect(await outdated()).toEqual([])
    })

    it('are untouched by a change Claude Code refused', async () => {
      await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)

      await backend.api.extensions.change(env.projects['recipe-box'], {
        action: 'remove-mcp-server',
        name: 'no-such-server',
        scope: 'global'
      })

      expect(await outdated()).toEqual([])
    })
  })
})
