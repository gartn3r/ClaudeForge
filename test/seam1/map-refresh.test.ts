import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Backend, WindowHost } from '../../src/backend'
import { GITHUB_REFRESH_INTERVAL_MS } from '../../src/backend/maps/refresh'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const SIZE = { cols: 100, rows: 30 }

/** Resolves with the next `map.changed` push, or rejects once `ms` pass without one. */
function nextMapChange(backend: Backend, ms = 5_000): Promise<{ project: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`No map.changed within ${ms} ms`))
    }, ms)
    const unsubscribe = backend.on('map.changed', (change) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(change)
    })
  })
}

/** Every `map.changed` push from now on, by Project. */
function recordMapChanges(backend: Backend): string[] {
  const changes: string[] = []
  backend.on('map.changed', ({ project }) => changes.push(project))
  return changes
}

const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Stands in for the Electron window: the user can leave it, minimize it and come back to it. */
function fakeWindow(): WindowHost & { focus(): void; setVisible(visible: boolean): void } {
  let visible = true
  const focusListeners = new Set<() => void>()
  const visibilityListeners = new Set<(visible: boolean) => void>()
  return {
    focus() {
      for (const listener of focusListeners) listener()
    },
    setVisible(value) {
      visible = value
      for (const listener of visibilityListeners) listener(value)
    },
    isVisible: () => visible,
    onVisibilityChange(listener) {
      visibilityListeners.add(listener)
      return () => visibilityListeners.delete(listener)
    },
    onFocus(listener) {
      focusListeners.add(listener)
      return () => focusListeners.delete(listener)
    },
    minimize() {},
    toggleMaximize() {},
    close() {},
    onCloseRequest: () => () => undefined,
    isMaximized: () => false,
    onMaximizedChange: () => () => undefined,
    notify() {}
  }
}

describe('Live Map refresh', () => {
  let env: FakeEnvironment
  let backend: Backend

  afterEach(async () => {
    vi.useRealTimers()
    backend.dispose()
    await env.dispose()
  })

  describe('on a local markdown Tracker', () => {
    const effort = (): string => join(env.projects['recipe-box'], '.scratch', 'meal-planner')

    const start = async (): Promise<string> => {
      env = await createFakeEnvironment()
      backend = startBackend(env)
      return env.projects['recipe-box']
    }

    it('pushes map-changed as soon as a Ticket file is written, and the Map then shows it', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)

      const changed = nextMapChange(backend)
      await writeFile(join(effort(), 'issues', '07-shopping-budget.md'), '# Shopping budget\n\nType: research\nStatus: open\n')

      expect(await changed).toEqual({ project })
      const map = await backend.api.map.load(project, 'meal-planner')
      expect(map.tickets.map((ticket) => ticket.name)).toContain('Shopping budget')
    })

    it('pushes map-changed when a Ticket closes, even with the Map panel collapsed', async () => {
      const project = await start()
      await backend.api.map.watch(project, false)
      const ticket = join(effort(), 'issues', '02-week-view.md')

      const changed = nextMapChange(backend)
      await writeFile(ticket, (await readFile(ticket, 'utf8')).replace('Status: open', 'Status: resolved'))

      expect(await changed).toEqual({ project })
      const map = await backend.api.map.load(project, 'meal-planner')
      expect(map.decided).toContain('02')
    })

    it('pushes once for files written together, and nothing for files outside the Maps', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      const changes = recordMapChanges(backend)

      await writeFile(join(project, 'README.md'), 'Recipes.\n')
      await settle()
      expect(changes).toEqual([])

      await writeFile(join(effort(), 'issues', '07-shopping-budget.md'), '# Shopping budget\n')
      await writeFile(join(effort(), 'map.md'), '# Meal planner\n\n## Destination\n\nPlan a week.\n')
      await vi.waitFor(() => expect(changes).toEqual([project]))
      await settle()
      expect(changes).toEqual([project])
    })

    it("stops watching a Project's files once another Project is displayed", async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      await backend.api.map.watch(env.projects.dotfiles, true)
      const changes = recordMapChanges(backend)

      await writeFile(join(effort(), 'issues', '07-shopping-budget.md'), '# Shopping budget\n')
      await settle()

      expect(changes).toEqual([])
    })

    it('pushes map-changed when the user presses refresh', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)

      const changed = nextMapChange(backend)
      await backend.api.map.refresh(project)

      expect(await changed).toEqual({ project })
    })

    it('reads the files only, never polling', async () => {
      const project = await start()
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      await backend.api.map.watch(project, true)
      const changes = recordMapChanges(backend)

      vi.advanceTimersByTime(3 * GITHUB_REFRESH_INTERVAL_MS)

      expect(changes).toEqual([])
    })
  })

  describe('on a GitHub Tracker', () => {
    let win: ReturnType<typeof fakeWindow>

    const start = async (): Promise<string> => {
      env = await createFakeEnvironment()
      win = fakeWindow()
      backend = startBackend(env, win)
      return env.projects['harbor-api']
    }

    /** Closes a Ticket of a Map on GitHub, as the fake `gh` replays it from then on. */
    const closeOnGitHub = async (mapNumber: number, ticketNumber: number): Promise<void> => {
      const file = join(env.ghRecordings, 'api', 'repos', 'fixture', 'harbor-api', 'issues', String(mapNumber), 'sub_issues.json')
      const issues = JSON.parse(await readFile(file, 'utf8')) as Array<{ number: number; state: string }>
      for (const issue of issues) if (issue.number === ticketNumber) issue.state = 'closed'
      await writeFile(file, JSON.stringify(issues))
    }

    const isOpen = async (project: string, ticketId: string): Promise<boolean | undefined> =>
      (await backend.api.map.load(project, '40')).tickets.find((ticket) => ticket.id === ticketId)?.open

    it('reads the Map again when a turn ends in a Session of the Project', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      const { id } = await backend.api.sessionHost.start(project, SIZE)
      await closeOnGitHub(40, 42)

      const changed = nextMapChange(backend, 15_000)
      await backend.api.sessionHost.write(id, '/work 300\r')

      expect(await changed).toEqual({ project })
      expect(await isOpen(project, '42')).toBe(false)
    })

    it("reads the Map again when a turn ends in a git worktree of the Project, never in another Project's Session", async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      const changes = recordMapChanges(backend)
      const turnEnds: string[] = []
      backend.on('sessionHost.turnEnded', ({ cwd }) => turnEnds.push(cwd))
      const elsewhere = await backend.api.sessionHost.start(env.projects['recipe-box'], SIZE)
      await backend.api.sessionHost.write(elsewhere.id, '/work 100\r')
      await vi.waitFor(() => expect(turnEnds).toHaveLength(1), { timeout: 15_000 })
      await settle()
      expect(changes).toEqual([])

      const worktree = join(project, '.claude', 'worktrees', 'burst-allowance')
      await mkdir(worktree, { recursive: true })
      const inWorktree = await backend.api.sessionHost.start(worktree, SIZE)
      await backend.api.sessionHost.write(inWorktree.id, '/work 100\r')

      await vi.waitFor(() => expect(changes).toEqual([project]), { timeout: 15_000 })
    })

    it('reads the Map again when the user comes back to the window', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      await closeOnGitHub(40, 42)

      const changed = nextMapChange(backend)
      win.focus()

      expect(await changed).toEqual({ project })
      expect(await isOpen(project, '42')).toBe(false)
    })

    it('reads the Map again when the user presses refresh', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      await closeOnGitHub(40, 42)

      const changed = nextMapChange(backend)
      await backend.api.map.refresh(project)

      expect(await changed).toEqual({ project })
      expect(await isOpen(project, '42')).toBe(false)
    })

    it('leaves reading GitHub to the interface, which lists and loads again on map-changed', async () => {
      const project = await start()
      await backend.api.map.watch(project, true)
      const before = (await env.invocations('gh')).length

      win.focus()
      await settle()

      expect((await env.invocations('gh')).length).toBe(before)
    })

    describe('about every minute', () => {
      it('reads the Map again while it is on show', async () => {
        const project = await start()
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        await backend.api.map.watch(project, true)
        const changes = recordMapChanges(backend)

        vi.advanceTimersByTime(GITHUB_REFRESH_INTERVAL_MS - 1)
        expect(changes).toEqual([])
        vi.advanceTimersByTime(1)
        expect(changes).toEqual([project])
        vi.advanceTimersByTime(GITHUB_REFRESH_INTERVAL_MS)
        expect(changes).toEqual([project, project])
      })

      it('counts the minute from the last refresh, whatever asked for it', async () => {
        const project = await start()
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        await backend.api.map.watch(project, true)
        const changes = recordMapChanges(backend)

        vi.advanceTimersByTime(GITHUB_REFRESH_INTERVAL_MS / 2)
        win.focus()
        vi.advanceTimersByTime(GITHUB_REFRESH_INTERVAL_MS / 2)
        expect(changes).toEqual([project])

        vi.advanceTimersByTime(GITHUB_REFRESH_INTERVAL_MS / 2)
        expect(changes).toEqual([project, project])
      })

      it('never polls while the Map panel is collapsed or the window is minimized', async () => {
        const project = await start()
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        await backend.api.map.watch(project, false)
        const changes = recordMapChanges(backend)

        vi.advanceTimersByTime(3 * GITHUB_REFRESH_INTERVAL_MS)
        expect(changes).toEqual([])

        await backend.api.map.watch(project, true)
        win.setVisible(false)
        vi.advanceTimersByTime(3 * GITHUB_REFRESH_INTERVAL_MS)
        expect(changes).toEqual([])

        win.setVisible(true)
        vi.advanceTimersByTime(GITHUB_REFRESH_INTERVAL_MS)
        expect(changes).toEqual([project])
      })
    })
  })
})
