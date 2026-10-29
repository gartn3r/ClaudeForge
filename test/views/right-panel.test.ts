import { describe, expect, it } from 'vitest'
import { MAP_TAB, rightPanelState, tabToBringForward, tabsToMarkSeen } from '../../src/renderer/src/elements/right-panel'
import { PROPERTIES_TAKEN, defaultOwnProperties, type Attention, type ElementView } from '../../src/shared/elements'

const project = 'C:\\projects\\recipe-box'

const own = (id: 'panel-tab:map' | 'explorer', visible = true): ElementView => ({
  id,
  project: null,
  kind: null,
  container: id === MAP_TAB ? 'right-panel' : null,
  properties: { ...defaultOwnProperties(id), ...(id === MAP_TAB ? { visible } : {}) },
  takes: PROPERTIES_TAKEN[id],
  contentKinds: [],
  items: [],
  attention: null
})

const tab = (name: string, order: number, more: { visible?: boolean; attention?: Attention } = {}): ElementView => ({
  id: `panel-tab:${name}`,
  project,
  kind: 'panel-tab',
  container: 'right-panel',
  properties: { visible: more.visible ?? true, order, title: name, textColor: null, backgroundColor: null },
  takes: PROPERTIES_TAKEN['panel-tab'],
  contentKinds: ['text', 'link', 'file', 'web-page', 'action'],
  items: [],
  attention: more.attention ?? null
})

const card: ElementView = { ...tab('release', 1), id: 'card:release', kind: 'card', container: 'explorer' }

const ids = (elements: readonly ElementView[]): string[] => elements.map((element) => element.id)

describe('the Right panel’s Panel tabs', () => {
  it('puts the Map Panel tab first, then the Project’s Created Panel tabs in order, and nothing else', () => {
    const state = rightPanelState({
      elements: [own('explorer'), own(MAP_TAB), tab('coverage', 3), card, tab('tests', 2)],
      chosen: null,
      hasMap: true,
      openedAnyway: false
    })
    expect(ids(state.tabs)).toEqual([MAP_TAB, 'panel-tab:tests', 'panel-tab:coverage'])
  })

  it('keeps the Map Panel tab first even when a Created one is ordered before it', () => {
    const state = rightPanelState({ elements: [own(MAP_TAB), tab('tests', -5)], chosen: null, hasMap: true, openedAnyway: false })
    expect(ids(state.tabs)).toEqual([MAP_TAB, 'panel-tab:tests'])
  })

  it('leaves hidden Panel tabs out, the Map Panel tab included', () => {
    const state = rightPanelState({
      elements: [own(MAP_TAB, false), tab('tests', 1, { visible: false }), tab('coverage', 2)],
      chosen: null,
      hasMap: true,
      openedAnyway: false
    })
    expect(ids(state.tabs)).toEqual(['panel-tab:coverage'])
    expect(state.shown?.id).toBe('panel-tab:coverage')
  })

  it('moves among them the Created Panel tabs only, hidden ones included, in their order', () => {
    const state = rightPanelState({
      elements: [own(MAP_TAB), tab('coverage', 3), card, tab('tests', 2, { visible: false }), tab('lint', 1)],
      chosen: null,
      hasMap: true,
      openedAnyway: false
    })
    expect(ids(state.movable)).toEqual(['panel-tab:lint', 'panel-tab:tests', 'panel-tab:coverage'])
  })

  it('shows only the Map Panel tab while the Elements are still being read', () => {
    const state = rightPanelState({ elements: null, chosen: null, hasMap: true, openedAnyway: false })
    expect(ids(state.tabs)).toEqual([MAP_TAB])
    expect(state.shown?.id).toBe(MAP_TAB)
    expect(state.autoCollapsed).toBe(false)
  })
})

describe('the Panel tab on show', () => {
  const elements = [own(MAP_TAB), tab('tests', 1), tab('coverage', 2)]

  it('is the Map with a Map, until the user chooses another', () => {
    expect(rightPanelState({ elements, chosen: null, hasMap: true, openedAnyway: false }).shown?.id).toBe(MAP_TAB)
    expect(rightPanelState({ elements, chosen: 'panel-tab:coverage', hasMap: true, openedAnyway: false }).shown?.id).toBe(
      'panel-tab:coverage'
    )
  })

  it('falls back when the chosen one is gone', () => {
    expect(rightPanelState({ elements, chosen: 'panel-tab:closed', hasMap: true, openedAnyway: false }).shown?.id).toBe(MAP_TAB)
  })

  it('is the first other Panel tab without a Map', () => {
    expect(rightPanelState({ elements, chosen: null, hasMap: false, openedAnyway: false }).shown?.id).toBe('panel-tab:tests')
  })

  it('is the Map Panel tab without a Map nor any other, once the user opens the panel anyway', () => {
    const state = rightPanelState({ elements: [own(MAP_TAB)], chosen: null, hasMap: false, openedAnyway: true })
    expect(state.shown?.id).toBe(MAP_TAB)
  })
})

describe('the Right panel collapsing on its own', () => {
  it('collapses only when the Project has neither a Map nor any other Panel tab', () => {
    const lone = { elements: [own(MAP_TAB)], chosen: null, openedAnyway: false }
    expect(rightPanelState({ ...lone, hasMap: false }).autoCollapsed).toBe(true)
    expect(rightPanelState({ ...lone, hasMap: true }).autoCollapsed).toBe(false)
    expect(rightPanelState({ ...lone, elements: [own(MAP_TAB), tab('tests', 1)], hasMap: false }).autoCollapsed).toBe(false)
  })

  it('stays open once the user opened it anyway', () => {
    expect(rightPanelState({ elements: [own(MAP_TAB)], chosen: null, hasMap: false, openedAnyway: true }).autoCollapsed).toBe(false)
  })

  it('counts a hidden Map Panel tab as no Map, and a hidden Panel tab as none', () => {
    const state = rightPanelState({
      elements: [own(MAP_TAB, false), tab('tests', 1, { visible: false })],
      chosen: null,
      hasMap: true,
      openedAnyway: false
    })
    expect(state.autoCollapsed).toBe(true)
  })
})

describe('Panel tabs asking for attention', () => {
  it('brings forward the last Panel tab that asks to come to the front', () => {
    const state = rightPanelState({
      elements: [own(MAP_TAB), tab('tests', 1, { attention: 'front' }), tab('coverage', 2, { attention: 'front' })],
      chosen: null,
      hasMap: true,
      openedAnyway: false
    })
    expect(tabToBringForward(state.tabs)).toBe('panel-tab:coverage')
    expect(tabToBringForward(rightPanelState({ elements: [own(MAP_TAB), tab('tests', 1, { attention: 'mark' })], chosen: null, hasMap: true, openedAnyway: false }).tabs)).toBeNull()
  })

  it('marks as seen the Panel tab on show once the panel is open, and only that one', () => {
    const state = rightPanelState({
      elements: [own(MAP_TAB), tab('tests', 1, { attention: 'mark' }), tab('coverage', 2, { attention: 'mark' })],
      chosen: 'panel-tab:tests',
      hasMap: true,
      openedAnyway: false
    })
    expect(ids(tabsToMarkSeen(state, { collapsed: false }))).toEqual(['panel-tab:tests'])
    expect(tabsToMarkSeen(state, { collapsed: true })).toEqual([])
  })
})
