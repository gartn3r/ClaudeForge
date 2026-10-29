import { describe, expect, it } from 'vitest'
import {
  closeRequest,
  collapseRequest,
  colorRequest,
  createRequest,
  elementMenuKeys,
  hideRequest,
  itemMenuKeys,
  itemRequest,
  moveRequests,
  nameFromTitle,
  removeRequest,
  renameRequest,
  shortcutOf
} from '../../src/renderer/src/elements/element-menus'
import type { ContentItem, ElementView } from '../../src/shared/elements'
import { shortcutProblems } from '../../src/shared/shortcuts'

const project = 'C:\\projects\\recipe-box'

const card: ElementView = {
  id: 'card:release',
  project,
  kind: 'card',
  container: 'explorer',
  properties: { visible: true, collapsed: false, order: 4, title: 'Release', textColor: null, backgroundColor: null },
  takes: ['visible', 'collapsed', 'order', 'title', 'textColor', 'backgroundColor'],
  contentKinds: ['text', 'link', 'file', 'action'],
  items: [],
  attention: null
}

const own = (id: string, takes: ElementView['takes']): ElementView => ({
  id,
  project: null,
  kind: null,
  container: null,
  properties: {},
  takes,
  contentKinds: [],
  items: [],
  attention: null
})

/** The explorer's own cards in the Default layout, and the card created after them. */
const explorerCards: ElementView[] = [
  { ...own('shortcuts', ['visible', 'collapsed', 'order']), container: 'explorer', properties: { visible: true, order: 1 } },
  { ...own('sessions', ['visible', 'collapsed', 'order']), container: 'explorer', properties: { visible: true, order: 2 } },
  { ...own('extensions', ['visible', 'collapsed', 'order']), container: 'explorer', properties: { visible: true, order: 3 } },
  card
]

const link: ContentItem = { id: 'ci', kind: 'link', title: 'CI', address: 'https://ci.example.com', writtenBy: { kind: 'user' } }
const action: ContentItem = { id: 'rerun', kind: 'action', command: '/run-tests --watch', writtenBy: { kind: 'user' } }
const text: ContentItem = { id: 'notes', kind: 'text', text: 'v2', writtenBy: { kind: 'user' } }

describe("an Element's right-click menu", () => {
  it('offers rename, colours, adding a Content item, collapse, hide, copying its identifier and closing a Created Element', () => {
    expect(elementMenuKeys(card)).toEqual(['rename', 'text-color', 'background-color', 'add-item', 'collapse', 'hide', 'copy-id', 'close'])
    expect(elementMenuKeys({ ...card, properties: { ...card.properties, collapsed: true } })).toContain('expand')
  })

  it('offers moving an Element up or down among the visible others of its container, when they are given', () => {
    const [shortcuts, sessions, extensions] = explorerCards
    expect(elementMenuKeys(card, explorerCards)).toEqual(expect.arrayContaining(['move-up']))
    expect(elementMenuKeys(card, explorerCards)).not.toContain('move-down')
    expect(elementMenuKeys(shortcuts!, explorerCards)).toEqual(expect.arrayContaining(['move-down']))
    expect(elementMenuKeys(shortcuts!, explorerCards)).not.toContain('move-up')
    expect(elementMenuKeys(sessions!, explorerCards)).toEqual(expect.arrayContaining(['move-up', 'move-down']))
    // Hidden Elements are passed over: nothing visible is above the Sessions once the Shortcuts are hidden.
    const hidden = explorerCards.map((each) => (each === shortcuts ? { ...each, properties: { ...each.properties, visible: false } } : each))
    expect(elementMenuKeys(sessions!, hidden)).not.toContain('move-up')
    expect(elementMenuKeys(extensions!)).not.toContain('move-up')
  })

  it("offers only what ClaudeForge's own Elements take: they can be hidden, never closed", () => {
    expect(elementMenuKeys(own('shortcuts', ['visible', 'collapsed', 'order', 'title', 'textColor', 'backgroundColor']))).toEqual([
      'rename',
      'text-color',
      'background-color',
      'collapse',
      'hide',
      'copy-id'
    ])
    expect(elementMenuKeys(own('title-bar', ['textColor', 'backgroundColor']))).toEqual(['text-color', 'background-color', 'copy-id'])
  })

  it('calls the contract for its Element, in its Project', () => {
    expect(hideRequest(card)).toEqual({ op: 'set', project, element: 'card:release', properties: { visible: false } })
    expect(closeRequest(card)).toEqual({ op: 'close', project, element: 'card:release' })
    expect(renameRequest(card, '  Release v2 ')).toEqual({ op: 'set', project, element: 'card:release', properties: { title: 'Release v2' } })
    // An empty title gives back the default one.
    expect(renameRequest(card, ' ')).toMatchObject({ properties: { title: null } })
    expect(colorRequest(card, 'backgroundColor', '#fde68a')).toMatchObject({ properties: { backgroundColor: '#fde68a' } })
    expect(colorRequest(card, 'textColor', null)).toMatchObject({ properties: { textColor: null } })
    expect(itemRequest(card, { kind: 'text', text: 'hi' })).toEqual({
      op: 'add',
      project,
      element: 'card:release',
      item: { kind: 'text', text: 'hi' }
    })
    // ClaudeForge's own Elements need no Project.
    expect(hideRequest(own('explorer', ['visible']))).toEqual({ op: 'set', element: 'explorer', properties: { visible: false } })
    expect(collapseRequest(card, true)).toEqual({ op: 'set', project, element: 'card:release', properties: { collapsed: true } })
  })

  it('moves an Element past its visible neighbour by numbering its container again, asking only for the orders that change', () => {
    const [shortcuts, , extensions] = explorerCards
    expect(moveRequests(explorerCards, card, -1)).toEqual([
      { op: 'set', project, element: 'card:release', properties: { order: 3 } },
      { op: 'set', element: 'extensions', properties: { order: 4 } }
    ])
    expect(moveRequests(explorerCards, shortcuts!, 1)).toEqual([
      { op: 'set', element: 'sessions', properties: { order: 1 } },
      { op: 'set', element: 'shortcuts', properties: { order: 2 } }
    ])
    // Past a hidden Element too, so the move shows: it lands just before its visible neighbour.
    const hidden = explorerCards.map((each) => (each === extensions ? { ...each, properties: { ...each.properties, visible: false } } : each))
    expect(moveRequests(hidden, card, -1)).toEqual([
      { op: 'set', project, element: 'card:release', properties: { order: 2 } },
      { op: 'set', element: 'sessions', properties: { order: 3 } },
      { op: 'set', element: 'extensions', properties: { order: 4 } }
    ])
    expect(moveRequests(explorerCards, card, 1)).toEqual([])
  })
})

describe('creating a card or a menu by hand', () => {
  it('suggests an identifier from the title, as the contract takes it', () => {
    expect(nameFromTitle('Rapport de tests')).toBe('rapport-de-tests')
    expect(nameFromTitle('  Été 2026 : sortie!  ')).toBe('ete-2026-sortie')
    expect(nameFromTitle('***')).toBe('')
    expect(nameFromTitle('a'.repeat(60))).toHaveLength(40)
  })

  it('creates it in the displayed Project, with the title given', () => {
    expect(createRequest('card', project, ' release ', ' Release ')).toEqual({
      op: 'create',
      project,
      kind: 'card',
      name: 'release',
      title: 'Release'
    })
    // No title: the name is its title.
    expect(createRequest('menu', project, 'tests', ' ')).toEqual({ op: 'create', project, kind: 'menu', name: 'tests' })
  })
})

describe("a Content item's right-click menu", () => {
  it('offers Keep as Shortcut on a link or an action, then edit, copying its identifier and remove', () => {
    expect(itemMenuKeys(link)).toEqual(['keep-as-shortcut', 'edit', 'copy-id', 'remove'])
    expect(itemMenuKeys(action)).toEqual(['keep-as-shortcut', 'edit', 'copy-id', 'remove'])
    expect(itemMenuKeys(text)).toEqual(['edit', 'copy-id', 'remove'])
  })

  it('removes through the contract, and edits by adding under the same identifier', () => {
    expect(removeRequest(card, link)).toEqual({ op: 'remove', project, element: 'card:release', item: 'ci' })
    expect(itemRequest(card, { id: 'ci', kind: 'link', address: 'https://ci.example.com/2' })).toMatchObject({
      op: 'add',
      item: { id: 'ci' }
    })
  })

  it('keeps a link as a Web shortcut and an action as a Skill shortcut, which the Shortcut form would take', () => {
    const web = shortcutOf(link, 'web-1')
    expect(web).toEqual({ id: 'web-1', name: 'CI', kind: 'web', address: 'https://ci.example.com' })
    const skill = shortcutOf(action, 'skill-1')
    expect(skill).toEqual({ id: 'skill-1', name: '/run-tests --watch', kind: 'skill', command: { mode: 'free', text: '/run-tests --watch' } })
    expect(shortcutProblems(web!)).toEqual([])
    expect(shortcutProblems(skill!)).toEqual([])
    expect(shortcutOf(text, 'x')).toBeNull()
  })
})
