import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import type { Extension, ExtensionKind } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

describe('Extension service', () => {
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

  const listed = async (project: string, kind: ExtensionKind): Promise<Extension[]> =>
    (await backend.api.extensions.list(project)).extensions.filter((extension) => extension.kind === kind)

  it('lists the user’s skills as global and the Project’s as its own', async () => {
    const skills = await listed(env.projects['recipe-box'], 'skill')

    expect(skills).toContainEqual({
      kind: 'skill',
      name: 'release-notes',
      scope: 'global',
      plugin: null,
      description: 'Drafts release notes from the commits since the last tag.'
    })
    expect(skills).toContainEqual({
      kind: 'skill',
      name: 'seed-data',
      scope: 'project',
      plugin: null,
      description: 'Fills the recipe box with demo recipes.'
    })
  })

  it('lists the user’s and the Project’s subagents, named by their frontmatter', async () => {
    const subagents = await listed(env.projects['recipe-box'], 'subagent')

    expect(subagents).toContainEqual({
      kind: 'subagent',
      name: 'code-reviewer',
      scope: 'global',
      plugin: null,
      description: 'Reviews a diff for correctness and style.'
    })
    expect(subagents).toContainEqual(
      expect.objectContaining({ name: 'migration-reviewer', scope: 'project', plugin: null })
    )
  })

  describe('MCP servers, from `claude mcp list`', () => {
    it('lists the user’s servers as global and the Project’s as its own, with their status', async () => {
      const servers = await listed(env.projects['recipe-box'], 'mcp-server')

      expect(servers).toEqual([
        {
          kind: 'mcp-server',
          name: 'claude.ai Supabase',
          scope: 'global',
          plugin: null,
          description: null,
          mcp: { status: 'needs-sign-in', detail: 'Needs authentication' }
        },
        {
          kind: 'mcp-server',
          name: 'github',
          scope: 'global',
          plugin: null,
          description: null,
          mcp: { status: 'connected', detail: 'Connected' }
        },
        expect.objectContaining({ name: 'pantry', scope: 'global', plugin: 'kitchen-tools' }),
        {
          kind: 'mcp-server',
          name: 'playwright',
          scope: 'project',
          plugin: null,
          description: null,
          mcp: { status: 'failed', detail: 'Failed to connect' }
        },
        expect.objectContaining({ name: 'postgres', scope: 'project', mcp: { status: 'connected', detail: 'Connected' } })
      ])
    })

    it('asks Claude Code in the Project’s folder, where it health-checks the Project’s servers too', async () => {
      await backend.api.extensions.list(env.projects['recipe-box'])

      const calls = (await env.invocations('claude')).filter(({ args }) => args.join(' ') === 'mcp list')
      expect(calls.map(({ cwd }) => cwd)).toContain(env.projects['recipe-box'])
    })

    it('reports a Project server still waiting for approval, and a server connected without its tools as failed', async () => {
      const servers = await listed(env.projects['harbor-api'], 'mcp-server')

      expect(servers).toContainEqual(
        expect.objectContaining({
          name: 'sentry',
          scope: 'project',
          mcp: { status: 'pending-approval', detail: 'Pending approval (run `claude` to approve)' }
        })
      )
      expect(servers).toContainEqual(
        expect.objectContaining({
          name: 'tracing',
          scope: 'project',
          mcp: { status: 'failed', detail: 'Connected · tools fetch failed' }
        })
      )
    })

    it('lists no Project server in a Project without any', async () => {
      const servers = await listed(env.projects.dotfiles, 'mcp-server')

      expect(servers.map(({ name, scope }) => [name, scope])).toEqual([
        ['claude.ai Supabase', 'global'],
        ['github', 'global'],
        ['pantry', 'global']
      ])
    })
  })

  describe('plugins, from `claude plugin list`', () => {
    it('lists the user’s plugins as global and those installed for the Project as its own, enabled or not', async () => {
      const plugins = await listed(env.projects['recipe-box'], 'plugin')

      expect(plugins).toEqual([
        {
          kind: 'plugin',
          name: 'atlas',
          scope: 'global',
          plugin: null,
          description: 'Searches the team wiki.',
          enabled: false
        },
        expect.objectContaining({ name: 'frontend-design', scope: 'project', enabled: true }),
        {
          kind: 'plugin',
          name: 'kitchen-tools',
          scope: 'global',
          plugin: null,
          description: 'Skills and agents for cooking apps.',
          enabled: true
        }
      ])
    })

    it('lists the skills and subagents an enabled plugin brings, in the plugin’s scope, naming the plugin', async () => {
      const { extensions } = await backend.api.extensions.list(env.projects['recipe-box'])

      expect(extensions).toContainEqual({
        kind: 'skill',
        name: 'menu-copy',
        scope: 'global',
        plugin: 'kitchen-tools',
        description: 'Writes menu descriptions for recipes.'
      })
      expect(extensions).toContainEqual(
        expect.objectContaining({ kind: 'subagent', name: 'sous-chef', scope: 'global', plugin: 'kitchen-tools' })
      )
      expect(extensions).toContainEqual(
        expect.objectContaining({ kind: 'skill', name: 'ui-polish', scope: 'project', plugin: 'frontend-design' })
      )
    })

    it('leaves out what a disabled plugin would bring', async () => {
      const { extensions } = await backend.api.extensions.list(env.projects['recipe-box'])

      expect(extensions.filter((extension) => extension.plugin === 'atlas')).toEqual([])
    })

    it('leaves out the plugins installed for another Project', async () => {
      const { extensions } = await backend.api.extensions.list(env.projects.dotfiles)

      expect(extensions.filter(({ name, plugin }) => name === 'frontend-design' || plugin === 'frontend-design')).toEqual([])
    })
  })

  it('still lists the user’s and the Project’s skills and subagents when Claude Code cannot answer', async () => {
    backend.dispose()
    await env.dispose()
    env = await createFakeEnvironment({ claude: false })
    backend = startBackend(env)

    const listing = await backend.api.extensions.list(env.projects['recipe-box'])

    expect(listing.problem).toBe('claude-failed')
    expect(listing.extensions.map(({ kind, name }) => `${kind} ${name}`)).toEqual([
      'skill release-notes',
      'skill seed-data',
      'subagent code-reviewer',
      'subagent migration-reviewer'
    ])
  })

  it('reports no problem when Claude Code answers', async () => {
    const listing = await backend.api.extensions.list(env.projects['recipe-box'])

    expect(listing.problem).toBeUndefined()
  })

  it('lists only the user’s own skills and subagents in a Project that has none', async () => {
    const { extensions } = await backend.api.extensions.list(env.projects.dotfiles)

    expect(extensions.filter((extension) => extension.plugin === null && extension.scope === 'project')).toEqual([])
    expect(extensions).toContainEqual(expect.objectContaining({ name: 'release-notes', scope: 'global' }))
  })
})
