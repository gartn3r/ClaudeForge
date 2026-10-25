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
