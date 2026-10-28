import { spawn, type ChildProcess } from 'node:child_process'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import type { ProjectSessions, SessionSummary } from '../../src/shared/api'
import { createFakeEnvironment, encodeProjectPath, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const children: ChildProcess[] = []

/** A process that stays alive until the test ends, standing in for a `claude` run elsewhere. */
function runningProcess(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { stdio: 'ignore' })
  children.push(child)
  return child
}

describe('the Session catalog', () => {
  let env: FakeEnvironment
  let backend: Backend

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    for (const child of children.splice(0)) child.kill()
    backend?.dispose()
    await env.dispose()
  })

  const titlesByProject = async (): Promise<Record<string, (string | null)[]>> => {
    const projects = await backend.api.sessions.list()
    return Object.fromEntries(projects.map((project) => [project.name, project.sessions.map((s) => s.title)]))
  }

  it('lists Sessions grouped by Project, the most recently active Project and Session first', async () => {
    backend = startBackend(env)

    const projects = await backend.api.sessions.list()

    expect(projects.map((project) => [project.name, project.path])).toEqual([
      ['harbor-api', env.projects['harbor-api']],
      ['recipe-box', env.projects['recipe-box']]
    ])
    expect(projects[0]!.sessions.map((session) => [session.title, session.lastActivity])).toEqual([
      ['Rate limiter rewrite', Date.parse('2026-10-25T10:02:00.000Z')],
      ['Paginate the audit log endpoint with cursors', Date.parse('2026-10-23T14:20:00.000Z')],
      ['Add an OpenAPI export', Date.parse('2026-10-22T09:12:30.000Z')]
    ])
    expect(await titlesByProject()).not.toHaveProperty('dotfiles')
  })

  it('folds Sessions run in a git worktree under their parent Project, labelled with the worktree', async () => {
    backend = startBackend(env)

    const [, recipeBox] = await backend.api.sessions.list()

    expect(recipeBox!.path).toBe(env.projects['recipe-box'])
    expect(recipeBox!.sessions.map((session) => [session.worktree, session.cwd])).toEqual([
      [null, env.projects['recipe-box']],
      ['week-view', env.worktrees['recipe-box@week-view']],
      ['leftovers', env.worktrees['recipe-box@leftovers']]
    ])
  })

  it("titles each Session with Claude Code's name for it, else the start of its first message", async () => {
    await env.writeHistory(env.projects.dotfiles, '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6', [
      { type: 'user', isMeta: true, cwd: env.projects.dotfiles, timestamp: '2026-10-21T08:00:00.000Z', message: { role: 'user', content: 'Caveat: local commands below.' } },
      { type: 'user', cwd: env.projects.dotfiles, timestamp: '2026-10-21T08:00:01.000Z', message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: '<system-reminder>\nToday is Tuesday.\n</system-reminder>\nWhy does my prompt   flicker?' }] } }
    ])
    backend = startBackend(env)

    expect(await titlesByProject()).toEqual({
      'harbor-api': ['Rate limiter rewrite', 'Paginate the audit log endpoint with cursors', 'Add an OpenAPI export'],
      'recipe-box': [
        'Chart the meal planner',
        '/wayfinder meal-planner 02',
        'Track leftovers in the fridge and suggest a meal that uses them up before they go off, ranked by how soon each ingredient expires'
      ],
      dotfiles: ['Why does my prompt flicker?']
    })
  })

  it('keeps a Session named with /rename under that name, over the name Claude Code generated', async () => {
    await env.writeHistory(env.projects.dotfiles, '1e2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7', [
      { type: 'user', cwd: env.projects.dotfiles, timestamp: '2026-10-21T08:00:00.000Z', message: { role: 'user', content: 'Set up my shell' } },
      { type: 'ai-title', aiTitle: 'Shell setup' },
      { type: 'custom-title', customTitle: 'Old name' },
      { type: 'custom-title', customTitle: 'Zsh on Windows' },
      { type: 'ai-title', aiTitle: 'Shell setup on Windows' }
    ])
    backend = startBackend(env)

    expect((await titlesByProject()).dotfiles).toEqual(['Zsh on Windows'])
  })

  it('marks a Session whose claude process runs outside ClaudeForge as External, and the others as past', async () => {
    backend = startBackend(env)

    const [harbor, recipeBox] = await backend.api.sessions.list()

    expect(harbor!.sessions.map((session) => [session.title, session.state])).toEqual([
      ['Rate limiter rewrite', 'external'],
      // Its registry entry outlived a crash: no process runs it any more.
      ['Paginate the audit log endpoint with cursors', 'past'],
      ['Add an OpenAPI export', 'past']
    ])
    expect(recipeBox!.sessions.every((session) => session.state === 'past')).toBe(true)
  })

  it('lists an External session started a moment ago, before it has any history, under its live name', async () => {
    const claude = runningProcess()
    await env.writeLiveSession({
      pid: claude.pid!,
      sessionId: '2f3a4b5c-6d7e-4f80-91a2-b3c4d5e6f7a8',
      cwd: env.projects.dotfiles,
      updatedAt: Date.parse('2026-10-25T11:00:00.000Z')
    })
    backend = startBackend(env)

    const [dotfiles] = await backend.api.sessions.list()

    expect(dotfiles).toEqual({
      path: env.projects.dotfiles,
      name: 'dotfiles',
      sessions: [
        {
          id: '2f3a4b5c-6d7e-4f80-91a2-b3c4d5e6f7a8',
          title: null,
          cwd: env.projects.dotfiles,
          worktree: null,
          lastActivity: Date.parse('2026-10-25T11:00:00.000Z'),
          state: 'external',
          hidden: false,
          wayfinder: null
        }
      ]
    })
  })

  it('titles a live Session with the name its running claude reports, which follows a rename at once', async () => {
    const claude = runningProcess()
    await env.writeLiveSession({
      pid: claude.pid!,
      sessionId: 'c3d2a8f1-1b7e-4c59-9e64-7f0a1d2b3c4d',
      cwd: env.projects['harbor-api'],
      name: 'Audit log cursors'
    })
    backend = startBackend(env)

    const [harbor] = await backend.api.sessions.list()

    expect(harbor!.sessions.find((session) => session.id === 'c3d2a8f1-1b7e-4c59-9e64-7f0a1d2b3c4d')).toMatchObject({
      title: 'Audit log cursors',
      state: 'external'
    })
  })

  it.runIf(process.platform === 'win32')(
    'sees through a registry entry whose process id Windows has given to another program',
    async () => {
      const other = runningProcess()
      await env.writeLiveSession({
        pid: other.pid!,
        sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11',
        cwd: env.projects['harbor-api'],
        // The crashed claude started long before the program now holding its id.
        procStart: '134370000000000000'
      })
      backend = startBackend(env)

      const [harbor] = await backend.api.sessions.list()

      expect(harbor!.sessions.find((session) => session.title === 'Add an OpenAPI export')!.state).toBe('past')
    }
  )

  it('keeps a Session run in a git submodule as a Project of its own', async () => {
    const submodule = join(env.projects.dotfiles, 'vendor', 'prompt')
    await mkdir(join(env.projects.dotfiles, '.git', 'modules', 'prompt'), { recursive: true })
    await mkdir(submodule, { recursive: true })
    await writeFile(join(submodule, '.git'), 'gitdir: ../../.git/modules/prompt\n')
    await env.writeHistory(submodule, '5c6d7e8f-90a1-4b2c-93d4-e5f6a7b8c9d0', [
      { type: 'user', cwd: submodule, timestamp: '2026-10-21T08:00:00.000Z', message: { role: 'user', content: 'Update the prompt theme' } }
    ])
    backend = startBackend(env)

    const projects = await backend.api.sessions.list()

    expect(projects.find((project) => project.path === submodule)?.sessions).toMatchObject([
      { title: 'Update the prompt theme', worktree: null }
    ])
  })

  it('ranks a live Session by its latest activity, whether in its history or reported by its claude', async () => {
    const claude = runningProcess()
    await env.writeLiveSession({
      pid: claude.pid!,
      sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11',
      cwd: env.projects['harbor-api'],
      updatedAt: Date.parse('2026-10-25T11:30:00.000Z')
    })
    backend = startBackend(env)

    const [harbor] = await backend.api.sessions.list()

    expect(harbor!.sessions[0]).toMatchObject({
      title: 'Add an OpenAPI export',
      lastActivity: Date.parse('2026-10-25T11:30:00.000Z')
    })
  })

  describe('pushes the new catalog when Claude Code changes it', () => {
    let pushed: ProjectSessions[][]

    const start = async (): Promise<void> => {
      backend = startBackend(env)
      pushed = []
      backend.on('sessions.changed', (projects) => pushed.push(projects))
      await backend.api.sessions.list()
    }

    /** The latest catalog pushed, once one satisfying the check arrives. */
    const nextPush = async (check: (projects: ProjectSessions[]) => boolean): Promise<void> => {
      await vi.waitFor(() => expect(pushed.some(check)).toBe(true), { timeout: 8_000, interval: 50 })
    }

    const sessionIn = (projects: ProjectSessions[], id: string): SessionSummary | undefined =>
      projects.flatMap((project) => project.sessions).find((session) => session.id === id)

    it('when a Session starts', async () => {
      // On the list as its `claude` starts, before it writes any history.
      await env.listSessions('3a4b5c6d-7e8f-4091-a2b3-c4d5e6f7a8b9')
      await start()

      await env.writeHistory(env.projects.dotfiles, '3a4b5c6d-7e8f-4091-a2b3-c4d5e6f7a8b9', [
        { type: 'user', cwd: env.projects.dotfiles, timestamp: '2026-10-25T12:00:00.000Z', message: { role: 'user', content: 'Sync my dotfiles' } }
      ])

      await nextPush((projects) => sessionIn(projects, '3a4b5c6d-7e8f-4091-a2b3-c4d5e6f7a8b9')?.title === 'Sync my dotfiles')
    })

    it('when a Session is renamed', async () => {
      await start()

      const folder = join(env.claudeHome, 'projects', encodeProjectPath(env.projects['harbor-api']))
      await appendFile(
        join(folder, '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11.jsonl'),
        JSON.stringify({ type: 'custom-title', customTitle: 'OpenAPI export', sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11' }) + '\n'
      )

      await nextPush((projects) => sessionIn(projects, '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11')?.title === 'OpenAPI export')
    })

    it('when an External session ends, as an ordinary past Session', async () => {
      const claude = runningProcess()
      const entry = await env.writeLiveSession({
        pid: claude.pid!,
        sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11',
        cwd: env.projects['harbor-api']
      })
      await start()

      await rm(entry)

      await nextPush((projects) => sessionIn(projects, '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11')?.state === 'past')
    })

    it("when an External session's claude dies without cleaning up after itself", async () => {
      const claude = runningProcess()
      await env.writeLiveSession({ pid: claude.pid!, sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', cwd: env.projects['harbor-api'] })
      await start()

      claude.kill()

      await nextPush((projects) => sessionIn(projects, '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11')?.state === 'past')
    })

    it('and stops once disposed', async () => {
      await start()
      backend.dispose()

      await env.writeHistory(env.projects.dotfiles, '4b5c6d7e-8f90-4a1b-82c3-d4e5f6a7b8c9', [
        { type: 'user', cwd: env.projects.dotfiles, timestamp: '2026-10-25T12:00:00.000Z', message: { role: 'user', content: 'Too late' } }
      ])
      await new Promise((done) => setTimeout(done, 3_000))

      expect(pushed).toEqual([])
    })
  })

  it("keeps a removed worktree's Sessions under its parent Project", async () => {
    await rm(env.worktrees['recipe-box@leftovers']!, { recursive: true })
    backend = startBackend(env)

    const [, recipeBox] = await backend.api.sessions.list()

    expect(recipeBox!.sessions.find((session) => session.worktree === 'leftovers')).toBeDefined()
  })
})
