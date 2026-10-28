import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

describe('app state', () => {
  let env: FakeEnvironment
  const backends: Backend[] = []

  const start = (): Backend => {
    const backend = startBackend(env)
    backends.push(backend)
    return backend
  }

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    for (const backend of backends.splice(0)) backend.dispose()
    await env.dispose()
  })

  it('starts with the explorer at 264px and the Map panel at 400px, both expanded', async () => {
    const { api } = start()

    expect((await api.appState.read()).layout).toEqual({
      explorer: { width: 264, collapsed: false },
      map: { width: 400, collapsed: false }
    })
  })

  it('keeps panel sizes and collapsed states across a restart', async () => {
    await start().api.appState.write({ layout: { explorer: { width: 310 }, map: { collapsed: true } } })

    const restarted = start()

    expect((await restarted.api.appState.read()).layout).toEqual({
      explorer: { width: 310, collapsed: false },
      map: { width: 400, collapsed: true }
    })
  })

  it('holds the explorer within 200–420px and the Map panel within 320–720px', async () => {
    const { api } = start()

    const narrow = await api.appState.write({ layout: { explorer: { width: 50 }, map: { width: 100 } } })
    expect(narrow.layout.explorer.width).toBe(200)
    expect(narrow.layout.map.width).toBe(320)

    const wide = await api.appState.write({ layout: { explorer: { width: 5000 }, map: { width: 5000 } } })
    expect(wide.layout.explorer.width).toBe(420)
    expect(wide.layout.map.width).toBe(720)
  })

  it('renders the terminal on the GPU until the user turns GPU rendering off, and remembers that across a restart', async () => {
    expect((await start().api.appState.read()).gpuRendering).toBe(true)

    await start().api.appState.write({ gpuRendering: false })

    expect((await start().api.appState.read()).gpuRendering).toBe(false)
  })

  it('notifies the user about Sessions until they turn notifications off, and remembers that across a restart', async () => {
    expect((await start().api.appState.read()).notifications).toBe(true)

    await start().api.appState.write({ notifications: false })

    expect((await start().api.appState.read()).notifications).toBe(false)
  })

  it('shows every Map as a graph with closed Tickets and nothing folded until the user changes it', async () => {
    expect((await start().api.appState.read()).maps).toEqual({})
  })

  it("keeps each Map's view, hidden closed Tickets and folded Parent Tickets across a restart", async () => {
    const harbor = env.projects['harbor-api']
    await start().api.appState.write({
      maps: { [harbor]: { '70': { view: 'tree', hideClosed: true, folded: ['75', '72', '75'] }, '40': { view: 'tree' } } }
    })

    const restarted = start()

    expect((await restarted.api.appState.read()).maps).toEqual({
      [harbor]: { '70': { view: 'tree', hideClosed: true, folded: ['75', '72'] }, '40': { view: 'tree' } }
    })
  })

  it("changes one Map's preferences without touching another's, and forgets those set back to the defaults", async () => {
    const harbor = env.projects['harbor-api']
    const recipes = env.projects['recipe-box']
    const { api } = start()
    await api.appState.write({
      maps: { [harbor]: { '70': { view: 'tree', hideClosed: true, folded: ['75'] } }, [recipes]: { 'meal-planner': { view: 'tree' } } }
    })

    const unfolded = await api.appState.write({ maps: { [harbor]: { '70': { folded: [] } } } })
    expect(unfolded.maps[harbor]).toEqual({ '70': { view: 'tree', hideClosed: true } })

    const graph = await api.appState.write({ maps: { [harbor]: { '70': { view: 'graph', hideClosed: false } } } })
    expect(graph.maps).toEqual({ [recipes]: { 'meal-planner': { view: 'tree' } } })

    const ignored = await api.appState.write({
      maps: { [recipes]: { 'meal-planner': { view: 'sideways', folded: [3, '01'] } } }
    } as never)
    expect(ignored.maps).toEqual({ [recipes]: { 'meal-planner': { view: 'tree', folded: ['01'] } } })
  })

  it('starts with no tabs to restore, then keeps the saved Hosted session tabs, in order, across a restart', async () => {
    const harbor = env.projects['harbor-api']
    const recipes = env.projects['recipe-box']
    expect((await start().api.appState.read()).tabs).toEqual([])

    await start().api.appState.write({
      tabs: [
        { sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', project: harbor, title: 'Add an OpenAPI export' },
        { sessionId: '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7', project: recipes, title: null }
      ]
    })

    expect((await start().api.appState.read()).tabs).toEqual([
      { sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', project: harbor, title: 'Add an OpenAPI export' },
      { sessionId: '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7', project: recipes, title: null }
    ])
  })

  it("drops at startup the saved tabs whose Session's folder is gone, from the saved state too", async () => {
    const harbor = env.projects['harbor-api']
    const recipes = env.projects['recipe-box']
    const kept = { sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', project: harbor, title: 'Add an OpenAPI export' }
    // A Session of the recipe-box worktree week-view.
    const gone = { sessionId: 'e5b8c1d0-2f4a-4b6c-8d9e-0a1b2c3d4e5f', project: recipes, title: 'Plan the week' }
    await start().api.appState.write({ tabs: [kept, gone] })
    await rm(env.worktrees['recipe-box@week-view']!, { recursive: true })

    expect((await start().api.appState.read()).tabs).toEqual([kept])
    const saved = JSON.parse(await readFile(join(env.userDataDir, 'state.json'), 'utf8'))
    expect(saved.tabs).toEqual([kept])
  })

  it('replaces the saved tabs with each write of them, leaving out malformed ones', async () => {
    const recipes = env.projects['recipe-box']
    const { api } = start()
    await api.appState.write({ tabs: [{ sessionId: '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11', project: recipes, title: null }] })

    const written = await api.appState.write({
      tabs: [
        { sessionId: '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7', project: recipes, title: 'Plan the week' },
        { sessionId: '', project: recipes, title: null },
        { sessionId: 'c3d2a8f1-1b7e-4c59-9e64-7f0a1d2b3c4d', title: null },
        { sessionId: 'e5b8c1d0-2f4a-4b6c-8d9e-0a1b2c3d4e5f', project: recipes, title: 42 },
        'not a tab'
      ]
    } as never)

    expect(written.tabs).toEqual([
      { sessionId: '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7', project: recipes, title: 'Plan the week' },
      { sessionId: 'e5b8c1d0-2f4a-4b6c-8d9e-0a1b2c3d4e5f', project: recipes, title: null }
    ])
    expect((await api.appState.write({ tabs: [] })).tabs).toEqual([])
  })

  it('pushes the new state to the interface after every write', async () => {
    const backend = start()
    const pushed: unknown[] = []
    backend.on('appState.changed', (state) => pushed.push(state.layout.explorer))

    await backend.api.appState.write({ layout: { explorer: { collapsed: true } } })
    await backend.api.appState.write({ layout: { explorer: { width: 333 } } })

    expect(pushed).toEqual([
      { width: 264, collapsed: true },
      { width: 333, collapsed: true }
    ])
  })
})
