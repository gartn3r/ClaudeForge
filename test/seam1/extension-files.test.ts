import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import type { Extension } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

describe('Skill and subagent files, written directly', () => {
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

  /** A file's text in \n line endings, whichever the fixtures were checked out with. */
  const textOf = async (file: string): Promise<string> => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')

  const find = async (project: string, kind: Extension['kind'], name: string): Promise<Extension | undefined> =>
    (await backend.api.extensions.list(project)).extensions.find(
      (extension) => extension.kind === kind && extension.name === name
    )

  /** The `claude mcp …` and `claude plugin …` commands that changed something. */
  const claudeChanges = async (): Promise<string[]> =>
    (await env.invocations('claude'))
      .filter(({ args }) => ['mcp', 'plugin'].includes(args[0]!) && args[1] !== 'list')
      .map(({ args }) => args.join(' '))

  describe('creating from a template', () => {
    it('creates a global skill in the Claude Code home, listed with its file', async () => {
      const project = env.projects['recipe-box']

      const created = await backend.api.extensions.create(project, { kind: 'skill', name: 'menu-planner', scope: 'global' })

      const file = join(env.claudeHome, 'skills', 'menu-planner', 'SKILL.md')
      expect(created).toEqual({ ok: true, file })
      expect(await readFile(file, 'utf8')).toMatch(/^---\nname: menu-planner\ndescription: .+\n---\n/)
      expect(await find(env.projects.dotfiles, 'skill', 'menu-planner')).toEqual({
        kind: 'skill',
        name: 'menu-planner',
        scope: 'global',
        plugin: null,
        description: expect.any(String),
        file
      })
      // Skills and subagents are plain files: no Claude Code command makes them (ADR 0003).
      expect(await claudeChanges()).toEqual([])
    })

    it('creates a Project subagent in the Project’s .claude/agents', async () => {
      const project = env.projects['harbor-api']

      const created = await backend.api.extensions.create(project, {
        kind: 'subagent',
        name: 'api-tester',
        scope: 'project'
      })

      const file = join(project, '.claude', 'agents', 'api-tester.md')
      expect(created).toEqual({ ok: true, file })
      expect(await readFile(file, 'utf8')).toMatch(/^---\nname: api-tester\ndescription: .+\n/)
      expect(await find(project, 'subagent', 'api-tester')).toMatchObject({ scope: 'project', plugin: null, file })
      expect(await find(env.projects.dotfiles, 'subagent', 'api-tester')).toBeUndefined()
    })

    it('creates files that pass their own validation', async () => {
      const project = env.projects.dotfiles
      for (const kind of ['skill', 'subagent'] as const) {
        const created = await backend.api.extensions.create(project, { kind, name: `fresh-${kind}`, scope: 'project' })
        if (!created.ok) throw new Error(`Creating a ${kind} failed`)
        const { text } = await backend.api.extensions.read(project, created.file)

        expect(await backend.api.extensions.save(project, created.file, text)).toEqual({ ok: true })
      }
    })

    it('refuses a name already taken at that scope, leaving the file as it was', async () => {
      const project = env.projects['recipe-box']
      const file = join(project, '.claude', 'skills', 'seed-data', 'SKILL.md')
      const before = await readFile(file, 'utf8')

      const created = await backend.api.extensions.create(project, { kind: 'skill', name: 'seed-data', scope: 'project' })

      expect(created).toEqual({ ok: false, problem: 'exists' })
      expect(await readFile(file, 'utf8')).toBe(before)
      // The same name is free at the other scope.
      expect(await backend.api.extensions.create(project, { kind: 'skill', name: 'seed-data', scope: 'global' })).toMatchObject({
        ok: true
      })
    })

    it.each(['Menu Planner', '../escape', 'menu_planner', '-menu', '', 'a'.repeat(65)])(
      'refuses the name %j: lowercase letters, numbers and hyphens only',
      async (name) => {
        const created = await backend.api.extensions.create(env.projects['recipe-box'], {
          kind: 'subagent',
          name,
          scope: 'global'
        })

        expect(created).toEqual({ ok: false, problem: 'bad-name' })
      }
    )
  })

  describe('reading and saving', () => {
    it('reads a Project skill’s file as it is on disk', async () => {
      const project = env.projects['recipe-box']
      const seedData = await find(project, 'skill', 'seed-data')

      const opened = await backend.api.extensions.read(project, seedData!.file!)

      expect(opened).toEqual({
        file: join(project, '.claude', 'skills', 'seed-data', 'SKILL.md'),
        kind: 'skill',
        scope: 'project',
        text: await readFile(seedData!.file!, 'utf8')
      })
    })

    it('saves a global subagent, whose listing then shows the new description', async () => {
      const project = env.projects['recipe-box']
      const reviewer = await find(project, 'subagent', 'code-reviewer')
      const text = '---\nname: code-reviewer\ndescription: Reviews a diff, bugs first.\ntools: Read, Grep\n---\n\nBe brief.\n'

      expect(await backend.api.extensions.save(project, reviewer!.file!, text)).toEqual({ ok: true })

      expect(await textOf(reviewer!.file!)).toBe(text)
      expect(await find(project, 'subagent', 'code-reviewer')).toMatchObject({ description: 'Reviews a diff, bugs first.' })
    })

    it('keeps the Windows line endings a file was written with', async () => {
      const project = env.projects['recipe-box']
      const file = join(env.claudeHome, 'skills', 'release-notes', 'SKILL.md')
      await writeFile(file, '---\r\nname: release-notes\r\ndescription: Old.\r\n---\r\n\r\nOld body.\r\n')

      await backend.api.extensions.save(project, file, '---\nname: release-notes\ndescription: New.\n---\n\nNew body.\n')

      expect(await readFile(file, 'utf8')).toBe('---\r\nname: release-notes\r\ndescription: New.\r\n---\r\n\r\nNew body.\r\n')
    })

    it('lists only the user’s and the Project’s own skills and subagents with a file: a plugin’s are its own', async () => {
      const extensions = (await backend.api.extensions.list(env.projects['recipe-box'])).extensions

      expect(extensions.filter(({ file }) => file).map(({ name }) => name).sort()).toEqual([
        'code-reviewer',
        'migration-reviewer',
        'release-notes',
        'seed-data'
      ])
    })

    it('refuses to read or save any other file', async () => {
      const project = env.projects['recipe-box']
      const others = [
        join(env.claudeHome, 'settings.json'),
        join(project, 'package.json'),
        join(project, '.claude', 'skills', 'seed-data', 'notes.md'),
        join(project, '.claude', 'agents', '..', 'agents.md'),
        join(env.projects['harbor-api'], '.claude', 'agents', 'stranger.md'),
        'agents/code-reviewer.md'
      ]

      for (const file of others) {
        await expect(backend.api.extensions.read(project, file), file).rejects.toThrow()
        await expect(backend.api.extensions.save(project, file, '---\nname: x\ndescription: y\n---\n'), file).rejects.toThrow()
      }
      await expect(readFile(join(env.projects['harbor-api'], '.claude', 'agents', 'stranger.md'))).rejects.toThrow()
    })
  })

  describe('validating the frontmatter before saving', () => {
    const skillFile = (env: FakeEnvironment): string => join(env.claudeHome, 'skills', 'release-notes', 'SKILL.md')

    it.each([
      ['no frontmatter', '# Release notes\n', [{ code: 'no-frontmatter' }]],
      ['an unclosed frontmatter', '---\nname: release-notes\ndescription: Drafts notes.\n\nBody\n', [{ code: 'no-frontmatter' }]],
      ['a missing description', '---\nname: release-notes\n---\nBody\n', [{ code: 'missing', field: 'description' }]],
      ['a blank description', '---\nname: release-notes\ndescription: ""\n---\n', [{ code: 'missing', field: 'description' }]],
      [
        'a misspelt field',
        '---\nname: release-notes\ndescripton: Drafts notes.\n---\n',
        [{ code: 'missing', field: 'description' }]
      ],
      ['a missing name', '---\ndescription: Drafts notes.\n---\n', [{ code: 'missing', field: 'name' }]],
      ['a name with spaces', '---\nname: Release notes\ndescription: Drafts notes.\n---\n', [{ code: 'bad-name' }]],
      ['a name that is no text', '---\nname: [release]\ndescription: Drafts notes.\n---\n', [{ code: 'not-text', field: 'name' }]],
      [
        'an over-long description',
        `---\nname: release-notes\ndescription: ${'a'.repeat(1025)}\n---\n`,
        [{ code: 'too-long', field: 'description', max: 1024 }]
      ],
      ['fields that are a list', '---\n- name\n- description\n---\n', [{ code: 'not-fields' }]],
      [
        'invalid YAML',
        '---\nname: release-notes\ndescription: Drafts notes: from git\n---\n',
        [{ code: 'not-yaml', line: 3, detail: 'Nested mappings are not allowed in compact mappings' }]
      ]
    ])('refuses %s, writing nothing', async (_case, text, problems) => {
      const file = skillFile(env)
      const before = await readFile(file, 'utf8')

      const saved = await backend.api.extensions.save(env.projects['recipe-box'], file, text)

      expect(saved).toEqual({ ok: false, problems })
      expect(await readFile(file, 'utf8')).toBe(before)
    })

    it('lists every problem at once', async () => {
      const saved = await backend.api.extensions.save(
        env.projects['recipe-box'],
        join(env.claudeHome, 'agents', 'code-reviewer.md'),
        '---\nname: Code Reviewer\ntools: Read\n---\n'
      )

      expect(saved).toEqual({ ok: false, problems: [{ code: 'bad-name' }, { code: 'missing', field: 'description' }] })
    })

    it('accepts block scalars, quotes, comments and fields ClaudeForge does not know', async () => {
      const file = join(env.claudeHome, 'agents', 'code-reviewer.md')
      const text = [
        '---',
        '# Reviews before every merge.',
        "name: 'code-reviewer'",
        'description: >',
        '  Reviews a diff: bugs first,',
        '  then style.',
        'tools: [Read, Grep]',
        'model: inherit',
        'color: blue',
        '---',
        'Body',
        ''
      ].join('\n')

      expect(await backend.api.extensions.save(env.projects['recipe-box'], file, text)).toEqual({ ok: true })
      expect(await textOf(file)).toBe(text)
    })
  })
})
