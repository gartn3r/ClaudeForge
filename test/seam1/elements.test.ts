import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend, DesktopShell } from '../../src/backend'
import { PANEL_BOUNDS } from '../../src/shared/api'
import {
  OWN_ELEMENTS,
  describeRefusal,
  type Asker,
  type ElementOp,
  type ElementRequest,
  type ElementResult,
  type ElementView
} from '../../src/shared/elements'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const SIZE = { cols: 100, rows: 30 }

describe('Elements', () => {
  let env: FakeEnvironment
  const backends: Backend[] = []
  let opened: string[]

  const start = (): Backend => {
    const shell: DesktopShell = { openUrl: async () => undefined, openFile: async (path) => void opened.push(path) }
    const backend = startBackend(env, undefined, undefined, shell)
    backends.push(backend)
    return backend
  }

  beforeEach(async () => {
    env = await createFakeEnvironment()
    opened = []
  })

  afterEach(async () => {
    for (const backend of backends.splice(0)) backend.dispose()
    await env.dispose()
  })

  /** Asks as the given asker, by hand (the user) unless a Hosted session is named. */
  const ask = <Op extends ElementOp>(
    backend: Backend,
    request: Extract<ElementRequest, { op: Op }>,
    asker: Asker = { kind: 'user' }
  ): Promise<ElementResult<Op>> => backend.elements(asker).request(request)

  /** Asks, and fails the test when refused. */
  const must = async <Op extends ElementOp>(
    backend: Backend,
    request: Extract<ElementRequest, { op: Op }>,
    asker?: Asker
  ): Promise<Extract<ElementResult<Op>, { ok: true }>> => {
    const result = await ask(backend, request, asker)
    if (!result.ok) throw new Error(describeRefusal(result.refusal))
    return result as Extract<ElementResult<Op>, { ok: true }>
  }

  const list = async (backend: Backend, project?: string, asker?: Asker): Promise<ElementView[]> =>
    (await must(backend, { op: 'list', project }, asker)).elements

  const find = async (backend: Backend, id: string, project?: string, asker?: Asker): Promise<ElementView | undefined> =>
    (await list(backend, project, asker)).find((element) => element.id === id)

  /** Starts a Hosted session in a fixture Project; the asker it is, and its Claude Code Session id. */
  const hosted = async (backend: Backend, project: 'recipe-box' | 'harbor-api'): Promise<{ asker: Asker; sessionId: string }> => {
    const { id, sessionId } = await backend.api.sessionHost.start(env.projects[project], SIZE)
    return { asker: { kind: 'session', hostedSession: id }, sessionId }
  }

  describe("ClaudeForge's own Elements", () => {
    it('have fixed identifiers and the Default layout, and take no Content item', async () => {
      const elements = await list(start())
      expect(elements.map(({ id }) => id)).toEqual([...OWN_ELEMENTS])
      for (const element of elements) {
        expect(element).toMatchObject({ project: null, kind: null, items: [], contentKinds: [], attention: null })
      }
      const byId = Object.fromEntries(elements.map((element) => [element.id, element]))
      expect(byId.explorer!.properties).toEqual({
        visible: true,
        collapsed: false,
        width: PANEL_BOUNDS.explorer.default,
        textColor: null,
        backgroundColor: null
      })
      expect(byId['right-panel']!.properties.width).toBe(PANEL_BOUNDS.map.default)
      expect(byId.shortcuts).toMatchObject({ container: 'explorer', properties: { order: 1, title: null, collapsed: false } })
      expect(byId['work-items']).toMatchObject({ container: 'explorer', properties: { order: 2, title: null, collapsed: false } })
      expect(byId.sessions!.properties.order).toBe(3)
      expect(byId.extensions!.properties.order).toBe(4)
      expect(byId['panel-tab:map']).toMatchObject({
        container: 'right-panel',
        takes: ['visible', 'order', 'title', 'textColor', 'backgroundColor'],
        properties: { order: 0 }
      })
      expect(byId['title-bar']!.takes).toEqual(['textColor', 'backgroundColor'])
      expect(byId['terminal-area']!.takes).toEqual(['textColor', 'backgroundColor'])
    })

    it('keep one set of properties for the whole of ClaudeForge, across a restart', async () => {
      const backend = start()
      await must(backend, {
        op: 'set',
        element: 'shortcuts',
        properties: { title: '  Quick links ', order: 5, textColor: '#1f2937', backgroundColor: 'oklch(0.9 0.05 90 / 50%)' }
      })
      await must(backend, { op: 'set', element: 'explorer', properties: { visible: false } })

      const restarted = start()
      for (const project of [undefined, env.projects['recipe-box'], env.projects['harbor-api']]) {
        expect((await find(restarted, 'shortcuts', project))!.properties).toEqual({
          visible: true,
          collapsed: false,
          order: 5,
          title: 'Quick links',
          textColor: '#1f2937',
          backgroundColor: 'oklch(0.9 0.05 90 / 50%)'
        })
        expect((await find(restarted, 'explorer', project))!.properties.visible).toBe(false)
      }

      // A title or colour of null gives back the default.
      await must(restarted, { op: 'set', element: 'shortcuts', properties: { title: null, textColor: null } })
      expect((await find(restarted, 'shortcuts'))!.properties).toMatchObject({ title: null, textColor: null, order: 5 })
    })

    it("keep the columns' width and collapsed state where the window reads them, in the app state's layout", async () => {
      const backend = start()
      await must(backend, { op: 'set', element: 'explorer', properties: { width: 300, collapsed: true } })
      await must(backend, { op: 'set', element: 'right-panel', properties: { width: 500 } })
      expect((await backend.api.appState.read()).layout).toEqual({
        explorer: { width: 300, collapsed: true },
        map: { width: 500, collapsed: false }
      })

      // Resizing by hand, as today, is what the Elements report.
      await backend.api.appState.write({ layout: { map: { collapsed: true, width: 640 } } })
      expect((await find(backend, 'right-panel'))!.properties).toMatchObject({ width: 640, collapsed: true })
    })

    it('refuse a property they do not take, one that is not a property, and a value out of bounds, changing nothing', async () => {
      const backend = start()
      expect(await ask(backend, { op: 'set', element: 'explorer', properties: { title: 'Files' } })).toEqual({
        ok: false,
        refusal: {
          code: 'property-not-taken',
          element: 'explorer',
          property: 'title',
          takes: ['visible', 'collapsed', 'width', 'textColor', 'backgroundColor']
        }
      })
      expect(await ask(backend, { op: 'set', element: 'title-bar', properties: { visible: false } })).toMatchObject({
        ok: false,
        refusal: { code: 'property-not-taken', property: 'visible' }
      })
      expect(
        await ask(backend, { op: 'set', element: 'shortcuts', properties: { font: 'Comic Sans' } as never })
      ).toEqual({ ok: false, refusal: { code: 'unknown-property', property: 'font' } })
      expect(await ask(backend, { op: 'set', element: 'explorer', properties: { width: 9000 } })).toEqual({
        ok: false,
        refusal: { code: 'bad-value', property: 'width', min: PANEL_BOUNDS.explorer.min, max: PANEL_BOUNDS.explorer.max }
      })
      for (const color of ['red; display: none', 'url(x)', 'expression(alert(1))', '#12345']) {
        expect(await ask(backend, { op: 'set', element: 'sessions', properties: { textColor: color } }), color).toMatchObject({
          ok: false,
          refusal: { code: 'bad-value', property: 'textColor' }
        })
      }
      // One refused property: none of the others changes.
      await ask(backend, { op: 'set', element: 'shortcuts', properties: { title: 'Kept?', order: 1.5 } })
      expect((await find(backend, 'shortcuts'))!.properties).toMatchObject({ title: null, order: 1 })
      expect(await ask(backend, { op: 'set', element: 'status-bar', properties: { visible: false } })).toEqual({
        ok: false,
        refusal: { code: 'unknown-element', element: 'status-bar' }
      })
    })

    it('say each refusal in words the CLI can answer Claude with', () => {
      expect(
        describeRefusal({ code: 'property-not-taken', element: 'explorer', property: 'title', takes: ['visible', 'width'] })
      ).toBe('explorer takes visible, width only, not title.')
      expect(describeRefusal({ code: 'content-not-taken', element: 'menu:tests', kind: 'text', takes: ['link', 'action'] })).toBe(
        'menu:tests takes link, action only, not text.'
      )
    })
  })

  describe('Created Elements', () => {
    it('belong to their Project, come to the front when created, and survive a restart until closed', async () => {
      const recipeBox = env.projects['recipe-box']
      const harborApi = env.projects['harbor-api']
      const backend = start()
      const created = await must(backend, { op: 'create', project: recipeBox, kind: 'card', name: 'release', title: 'Release' })
      expect(created.element).toMatchObject({
        id: 'card:release',
        project: recipeBox,
        kind: 'card',
        container: 'explorer',
        properties: { visible: true, collapsed: false, title: 'Release', textColor: null, backgroundColor: null },
        contentKinds: ['text', 'link', 'file', 'action'],
        items: [],
        attention: 'front'
      })
      // After the explorer's own cards.
      expect(created.element.properties.order).toBeGreaterThan(3)
      await must(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'tests' })
      await must(backend, { op: 'create', project: recipeBox, kind: 'menu', name: 'tests', title: 'Tests' })

      const restarted = start()
      const ids = (await list(restarted, recipeBox)).filter(({ kind }) => kind).map(({ id }) => id)
      // As they were created; the interface sorts each container's by order.
      expect(ids).toEqual(['card:release', 'panel-tab:tests', 'menu:tests'])
      // Untitled, it is called by its name.
      expect((await find(restarted, 'panel-tab:tests', recipeBox))!.properties.title).toBe('tests')
      // Shown only while its Project is displayed.
      expect((await list(restarted, harborApi)).filter(({ kind }) => kind)).toEqual([])
      expect((await list(restarted)).filter(({ kind }) => kind)).toEqual([])

      await must(restarted, { op: 'close', project: recipeBox, element: 'card:release' })
      expect(await find(start(), 'card:release', recipeBox)).toBeUndefined()
      expect(await ask(restarted, { op: 'close', element: 'explorer' })).toEqual({
        ok: false,
        refusal: { code: 'not-created', element: 'explorer' }
      })
    })

    it('are named uniquely within their Project, and only where ClaudeForge provides for them', async () => {
      const recipeBox = env.projects['recipe-box']
      const backend = start()
      await must(backend, { op: 'create', project: recipeBox, kind: 'card', name: 'release' })
      expect(await ask(backend, { op: 'create', project: recipeBox, kind: 'card', name: 'release' })).toEqual({
        ok: false,
        refusal: { code: 'name-taken', element: 'card:release' }
      })
      // Another kind, or another Project, may take the same name.
      await must(backend, { op: 'create', project: recipeBox, kind: 'menu', name: 'release' })
      await must(backend, { op: 'create', project: env.projects['harbor-api'], kind: 'card', name: 'release' })

      for (const name of ['Release', 'release notes', '-release', 'a'.repeat(41), '']) {
        expect(await ask(backend, { op: 'create', project: recipeBox, kind: 'card', name }), name).toEqual({
          ok: false,
          refusal: { code: 'bad-name', name }
        })
      }
      // The Map Panel tab is ClaudeForge's own.
      expect(await ask(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'map' })).toMatchObject({
        ok: false,
        refusal: { code: 'bad-name' }
      })
      expect(await ask(backend, { op: 'create', project: recipeBox, kind: 'column' as never, name: 'left' })).toEqual({
        ok: false,
        refusal: { code: 'bad-kind', kind: 'column' }
      })
      expect(await ask(backend, { op: 'create', kind: 'card', name: 'nowhere' })).toEqual({
        ok: false,
        refusal: { code: 'no-project' }
      })
    })

    it('take their own properties, and refuse the others', async () => {
      const recipeBox = env.projects['recipe-box']
      const backend = start()
      await must(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'tests' })
      const set = await must(backend, {
        op: 'set',
        project: recipeBox,
        element: 'panel-tab:tests',
        properties: { title: 'Tests', order: 7, backgroundColor: '#fde68a', visible: false }
      })
      expect(set.element.properties).toEqual({ visible: false, order: 7, title: 'Tests', textColor: null, backgroundColor: '#fde68a' })
      expect(
        await ask(backend, { op: 'set', project: recipeBox, element: 'panel-tab:tests', properties: { collapsed: true } })
      ).toMatchObject({ ok: false, refusal: { code: 'property-not-taken', property: 'collapsed' } })
      expect(
        await ask(backend, { op: 'set', project: recipeBox, element: 'panel-tab:tests', properties: { width: 400 } })
      ).toMatchObject({ ok: false, refusal: { code: 'property-not-taken', property: 'width' } })
    })

    it("can be changed by their Project's Sessions only", async () => {
      const recipeBox = env.projects['recipe-box']
      const harborApi = env.projects['harbor-api']
      const backend = start()
      const harbor = await hosted(backend, 'harbor-api')
      const recipe = await hosted(backend, 'recipe-box')

      // A Session's Project is its own: it needs not name it.
      const created = await must(backend, { op: 'create', kind: 'card', name: 'release' }, harbor.asker)
      expect(created.element.project).toBe(harborApi)
      await must(backend, { op: 'create', kind: 'card', name: 'release' }, recipe.asker)
      // The Session lists ClaudeForge's own Elements and its Project's.
      expect((await list(backend, undefined, harbor.asker)).map(({ id }) => id)).toEqual([...OWN_ELEMENTS, 'card:release'])

      expect(
        await ask(backend, { op: 'set', project: recipeBox, element: 'card:release', properties: { title: 'Mine now' } }, harbor.asker)
      ).toEqual({ ok: false, refusal: { code: 'other-project', project: recipeBox, own: harborApi } })
      expect(
        await ask(backend, { op: 'add', project: recipeBox, element: 'card:release', item: { kind: 'text', text: 'hi' } }, harbor.asker)
      ).toMatchObject({ ok: false, refusal: { code: 'other-project' } })
      expect(await ask(backend, { op: 'close', project: recipeBox, element: 'card:release' }, harbor.asker)).toMatchObject({
        ok: false,
        refusal: { code: 'other-project' }
      })
      expect((await find(backend, 'card:release', recipeBox))!.properties.title).toBe('release')

      // ClaudeForge's own Elements are the same for every Session.
      await must(backend, { op: 'set', element: 'sessions', properties: { title: 'Work' } }, harbor.asker)
      expect((await find(backend, 'sessions', undefined, recipe.asker))!.properties.title).toBe('Work')
    })

    it('refuse a caller that is not a Hosted session running in ClaudeForge', async () => {
      const backend = start()
      const recipe = await hosted(backend, 'recipe-box')
      const unknown: Asker = { kind: 'session', hostedSession: 'not-a-hosted-session' }
      expect(await ask(backend, { op: 'list' }, unknown)).toEqual({ ok: false, refusal: { code: 'not-hosted' } })

      const ended = new Promise<void>((resolve) => backend.on('sessionHost.exit', () => resolve()))
      await backend.api.sessionHost.stop((recipe.asker as { hostedSession: string }).hostedSession)
      await ended
      expect(await ask(backend, { op: 'create', kind: 'card', name: 'late' }, recipe.asker)).toEqual({
        ok: false,
        refusal: { code: 'not-hosted' }
      })
    })

    it('leave the Default layout and opening files to the user', async () => {
      const backend = start()
      const recipe = await hosted(backend, 'recipe-box')
      expect(await ask(backend, { op: 'restore-default' }, recipe.asker)).toEqual({
        ok: false,
        refusal: { code: 'user-only', op: 'restore-default' }
      })
      await must(backend, { op: 'create', kind: 'card', name: 'files' }, recipe.asker)
      const report = join(env.projects['recipe-box'], 'report.md')
      await writeFile(report, '# Report\n')
      await must(backend, { op: 'add', element: 'card:files', item: { id: 'report', kind: 'file', path: report } }, recipe.asker)
      expect(await ask(backend, { op: 'open-file', element: 'card:files', item: 'report' }, recipe.asker)).toMatchObject({
        ok: false,
        refusal: { code: 'user-only' }
      })
    })
  })

  describe('Content items', () => {
    it('are added after the rest, or replace the item under an id already used, naming who wrote them last', async () => {
      const recipeBox = env.projects['recipe-box']
      const backend = start()
      const recipe = await hosted(backend, 'recipe-box')
      await must(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'tests' })

      const added = await must(backend, {
        op: 'add',
        project: recipeBox,
        element: 'panel-tab:tests',
        item: { id: 'summary', kind: 'text', text: '**12** passed' }
      })
      expect(added).toMatchObject({ item: 'summary', replaced: false })
      await must(backend, {
        op: 'add',
        project: recipeBox,
        element: 'panel-tab:tests',
        item: { id: 'ci', kind: 'link', title: 'CI', address: 'https://github.com/fixture/recipe-box/actions' }
      })
      const generated = await must(
        backend,
        { op: 'add', element: 'panel-tab:tests', item: { kind: 'action', title: 'Run again', command: '/run-tests --watch' } },
        recipe.asker
      )
      await must(backend, {
        op: 'add',
        project: recipeBox,
        element: 'panel-tab:tests',
        item: { kind: 'web-page', title: 'Coverage', address: 'http://localhost:5173/coverage' }
      })
      expect(generated.item).not.toBe('')

      // The same id replaces the item where it stands; the last write wins, and names its Session.
      const replaced = await must(
        backend,
        { op: 'add', element: 'panel-tab:tests', item: { id: 'summary', kind: 'text', text: '**11** passed, **1** failed' } },
        recipe.asker
      )
      expect(replaced.replaced).toBe(true)
      const items = (await find(start(), 'panel-tab:tests', recipeBox))!.items
      expect(items.map(({ id }) => id)).toEqual(['summary', 'ci', generated.item, expect.any(String)])
      expect(items[0]).toEqual({
        id: 'summary',
        kind: 'text',
        text: '**11** passed, **1** failed',
        writtenBy: { kind: 'session', sessionId: recipe.sessionId }
      })
      expect(items[1]!.writtenBy).toEqual({ kind: 'user' })
      expect(items[2]).toMatchObject({ kind: 'action', command: '/run-tests --watch', writtenBy: { kind: 'session' } })
      expect(new Set(items.map(({ id }) => id)).size).toBe(4)

      await must(backend, { op: 'remove', project: recipeBox, element: 'panel-tab:tests', item: 'ci' })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.items.map(({ id }) => id)).not.toContain('ci')
      expect(await ask(backend, { op: 'remove', project: recipeBox, element: 'panel-tab:tests', item: 'ci' })).toEqual({
        ok: false,
        refusal: { code: 'unknown-item', element: 'panel-tab:tests', item: 'ci' }
      })
    })

    it('are refused where their Element does not take their kind', async () => {
      const recipeBox = env.projects['recipe-box']
      const backend = start()
      await must(backend, { op: 'create', project: recipeBox, kind: 'card', name: 'release' })
      await must(backend, { op: 'create', project: recipeBox, kind: 'menu', name: 'tests' })
      const page = { kind: 'web-page', address: 'https://example.com' } as const

      expect(await ask(backend, { op: 'add', project: recipeBox, element: 'card:release', item: page })).toEqual({
        ok: false,
        refusal: { code: 'content-not-taken', element: 'card:release', kind: 'web-page', takes: ['text', 'link', 'file', 'action'] }
      })
      for (const item of [{ kind: 'text', text: 'hi' }, { kind: 'file', path: 'C:\\report.md' }, page] as const) {
        expect(await ask(backend, { op: 'add', project: recipeBox, element: 'menu:tests', item }), item.kind).toMatchObject({
          ok: false,
          refusal: { code: 'content-not-taken', takes: ['link', 'action'] }
        })
      }
      expect(await ask(backend, { op: 'add', element: 'explorer', item: { kind: 'text', text: 'hi' } })).toEqual({
        ok: false,
        refusal: { code: 'content-not-taken', element: 'explorer', kind: 'text', takes: [] }
      })
      // ClaudeForge's own Elements hold none to remove or read.
      expect(await ask(backend, { op: 'remove', element: 'shortcuts', item: 'web-1' })).toEqual({
        ok: false,
        refusal: { code: 'unknown-item', element: 'shortcuts', item: 'web-1' }
      })
      expect(await ask(backend, { op: 'read-file', element: 'explorer', item: 'file-1' })).toMatchObject({
        refusal: { code: 'unknown-item' }
      })
      // A card takes a file, shown as a link to it.
      await must(backend, { op: 'add', project: recipeBox, element: 'card:release', item: { kind: 'file', path: 'C:\\report.md' } })
    })

    it('are refused when malformed: a link that is no web page, a command that cannot be typed as it is', async () => {
      const recipeBox = env.projects['recipe-box']
      const backend = start()
      await must(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'tests' })
      const refused = async (item: unknown) =>
        ask(backend, { op: 'add', project: recipeBox, element: 'panel-tab:tests', item: item as never })

      expect(await refused({ kind: 'link', address: 'javascript:alert(1)' })).toEqual({
        ok: false,
        refusal: { code: 'bad-item', field: 'address' }
      })
      expect(await refused({ kind: 'link', address: 'file:///C:/Windows/System32/calc.exe' })).toMatchObject({
        refusal: { field: 'address' }
      })
      expect(await refused({ kind: 'web-page', address: 'ftp://example.com' })).toMatchObject({ refusal: { field: 'address' } })
      expect(await refused({ kind: 'action', command: '/review "deep"' })).toMatchObject({ refusal: { field: 'command' } })
      expect(await refused({ kind: 'action', command: 'npm test\r' })).toMatchObject({ refusal: { field: 'command' } })
      expect(await refused({ kind: 'file', path: 'report.md' })).toMatchObject({ refusal: { field: 'path' } })
      expect(await refused({ kind: 'text', text: '  ' })).toMatchObject({ refusal: { field: 'text' } })
      expect(await refused({ id: 'has space', kind: 'text', text: 'hi' })).toMatchObject({ refusal: { field: 'id' } })
      expect(await refused({ kind: 'video', address: 'https://example.com' })).toMatchObject({ refusal: { field: 'kind' } })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.items).toEqual([])
    })

    it('leave a mark on their Element, unless the change asks for it to be shown', async () => {
      const recipeBox = env.projects['recipe-box']
      const backend = start()
      const changes: Array<string | null> = []
      backend.on('elements.changed', ({ project }) => changes.push(project))
      await must(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'tests' })
      expect(changes).toEqual([recipeBox])
      await must(backend, { op: 'seen', project: recipeBox, element: 'panel-tab:tests' })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.attention).toBeNull()

      // A property change leaves none.
      await must(backend, { op: 'set', project: recipeBox, element: 'panel-tab:tests', properties: { title: 'Tests' } })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.attention).toBeNull()

      await must(backend, { op: 'add', project: recipeBox, element: 'panel-tab:tests', item: { kind: 'text', text: 'Running…' } })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.attention).toBe('mark')
      await must(backend, {
        op: 'add',
        project: recipeBox,
        element: 'panel-tab:tests',
        item: { kind: 'text', text: 'Done' },
        show: true
      })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.attention).toBe('front')
      // It lasts across a restart, until the interface has shown it.
      expect((await find(start(), 'panel-tab:tests', recipeBox))!.attention).toBe('front')
      await must(backend, { op: 'seen', project: recipeBox, element: 'panel-tab:tests' })
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.attention).toBeNull()
      expect(changes.every((project) => project === recipeBox)).toBe(true)
    })
  })

  describe('a file Content item', () => {
    it('follows its file on disk: reports when it changes and when it is missing', async () => {
      const recipeBox = env.projects['recipe-box']
      const report = join(recipeBox, 'coverage.md')
      await writeFile(report, '# Coverage\n80%\n')
      const backend = start()
      await must(backend, { op: 'create', project: recipeBox, kind: 'panel-tab', name: 'tests' })
      await must(backend, {
        op: 'add',
        project: recipeBox,
        element: 'panel-tab:tests',
        item: { id: 'coverage', kind: 'file', path: report }
      })
      await must(backend, { op: 'seen', project: recipeBox, element: 'panel-tab:tests' })
      const item = async () => (await find(backend, 'panel-tab:tests', recipeBox))!.items[0]!
      expect((await item()).file).toMatchObject({ state: 'present', size: 15 })
      expect(await must(backend, { op: 'read-file', project: recipeBox, element: 'panel-tab:tests', item: 'coverage' })).toMatchObject({
        file: { state: 'present' },
        text: '# Coverage\n80%\n'
      })

      const changes: Array<string | null> = []
      backend.on('elements.changed', ({ project }) => changes.push(project))
      await writeFile(report, '# Coverage\n92% and climbing\n')
      // ClaudeForge notices by itself, and says so.
      await vi.waitFor(() => expect(changes).toContain(recipeBox), { timeout: 10_000 })
      expect((await item()).file).toMatchObject({ state: 'present', size: 28 })
      // A change to its file is a change to its content.
      expect((await find(backend, 'panel-tab:tests', recipeBox))!.attention).toBe('mark')
      expect((await must(backend, { op: 'read-file', project: recipeBox, element: 'panel-tab:tests', item: 'coverage' })).text).toBe(
        '# Coverage\n92% and climbing\n'
      )

      changes.length = 0
      await rm(report)
      await vi.waitFor(() => expect(changes).toContain(recipeBox), { timeout: 10_000 })
      expect((await item()).file).toEqual({ state: 'missing' })
      expect(await must(backend, { op: 'read-file', project: recipeBox, element: 'panel-tab:tests', item: 'coverage' })).toEqual({
        ok: true,
        file: { state: 'missing' },
        text: null
      })

      // Followed again after a restart, missing until it is back.
      backend.dispose()
      const restarted = start()
      expect((await find(restarted, 'panel-tab:tests', recipeBox))!.items[0]!.file).toEqual({ state: 'missing' })
      const back = new Promise<void>((resolve) => restarted.on('elements.changed', () => resolve()))
      await writeFile(report, 'back')
      await back
      expect((await find(restarted, 'panel-tab:tests', recipeBox))!.items[0]!.file).toMatchObject({ state: 'present', size: 4 })
    })

    it('opens in its default app when it is a document, never when it could be a program', async () => {
      const recipeBox = env.projects['recipe-box']
      const report = join(recipeBox, 'report.md')
      const script = join(recipeBox, 'setup.bat')
      await writeFile(report, '# Report\n')
      await writeFile(script, 'echo hi\n')
      const backend = start()
      await must(backend, { op: 'create', project: recipeBox, kind: 'card', name: 'files' })
      await must(backend, { op: 'add', project: recipeBox, element: 'card:files', item: { id: 'report', kind: 'file', path: report } })
      await must(backend, { op: 'add', project: recipeBox, element: 'card:files', item: { id: 'setup', kind: 'file', path: script } })
      await must(backend, { op: 'add', project: recipeBox, element: 'card:files', item: { id: 'note', kind: 'text', text: 'hi' } })

      await must(backend, { op: 'open-file', project: recipeBox, element: 'card:files', item: 'report' })
      expect(await ask(backend, { op: 'open-file', project: recipeBox, element: 'card:files', item: 'setup' })).toEqual({
        ok: false,
        refusal: { code: 'not-a-document', path: script }
      })
      expect(await ask(backend, { op: 'open-file', project: recipeBox, element: 'card:files', item: 'note' })).toEqual({
        ok: false,
        refusal: { code: 'not-a-file', element: 'card:files', item: 'note' }
      })
      expect(opened).toEqual([report])
    })
  })

  describe('the Default layout', () => {
    it("gives ClaudeForge's own Elements back every original property; Created Elements are shown and expanded again, keeping titles and colours", async () => {
      const recipeBox = env.projects['recipe-box']
      const harborApi = env.projects['harbor-api']
      const backend = start()
      await must(backend, { op: 'set', element: 'explorer', properties: { width: 380, collapsed: true, visible: false, backgroundColor: '#000' } })
      await must(backend, { op: 'set', element: 'right-panel', properties: { width: 700, collapsed: true } })
      await must(backend, { op: 'set', element: 'shortcuts', properties: { title: 'Links', order: 9, textColor: '#f00' } })
      await must(backend, { op: 'set', element: 'panel-tab:map', properties: { visible: false, order: 5 } })
      await must(backend, { op: 'create', project: recipeBox, kind: 'card', name: 'release', title: 'Release' })
      await must(backend, {
        op: 'set',
        project: recipeBox,
        element: 'card:release',
        properties: { visible: false, collapsed: true, order: 0, textColor: '#123456', backgroundColor: '#abcdef' }
      })
      await must(backend, { op: 'add', project: recipeBox, element: 'card:release', item: { id: 'notes', kind: 'text', text: 'v2' } })
      await must(backend, { op: 'create', project: harborApi, kind: 'panel-tab', name: 'ci', title: 'CI' })
      await must(backend, { op: 'set', project: harborApi, element: 'panel-tab:ci', properties: { visible: false } })

      await must(backend, { op: 'restore-default' })

      const restarted = start()
      const fresh = await list(createdBackendWithDefaults())
      const own = (await list(restarted)).map(({ id, properties }) => ({ id, properties }))
      expect(own).toEqual(fresh.map(({ id, properties }) => ({ id, properties })))
      expect((await restarted.api.appState.read()).layout).toEqual({
        explorer: { width: PANEL_BOUNDS.explorer.default, collapsed: false },
        map: { width: PANEL_BOUNDS.map.default, collapsed: false }
      })
      expect(await find(restarted, 'card:release', recipeBox)).toMatchObject({
        properties: { visible: true, collapsed: false, order: 0, title: 'Release', textColor: '#123456', backgroundColor: '#abcdef' },
        items: [{ id: 'notes', text: 'v2' }]
      })
      expect(await find(restarted, 'panel-tab:ci', harborApi)).toMatchObject({ properties: { visible: true, title: 'CI' } })
    })

    it('keeps the App title the user gave, which is no Element of the Default layout', async () => {
      const backend = start()
      await backend.api.appState.write({ appTitle: 'Atelier de Paul' })

      await must(backend, { op: 'restore-default' })

      expect((await start().api.appState.read()).appTitle).toBe('Atelier de Paul')
    })

    /** A backend on a data folder of its own, which never changed anything: the Default layout as it ships. */
    function createdBackendWithDefaults(): Backend {
      const backend = startBackend({ ...env, userDataDir: join(env.root, 'pristine') })
      backends.push(backend)
      return backend
    }
  })
})
