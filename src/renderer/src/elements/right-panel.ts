// Which Panel tabs the Right panel shows, which one is on show, and when the panel collapses on its
// own (CONTEXT.md, Right panel): pure rules over the Elements the contract lists for the displayed
// Project.

import { PROPERTIES_TAKEN, defaultOwnProperties, inOrder, type ElementView, type OwnElementId } from '../../../shared/elements'

/** The first Panel tab, ClaudeForge's own: it shows what the Map panel always showed. */
export const MAP_TAB = 'panel-tab:map' satisfies OwnElementId

/** The Map Panel tab as the Default layout has it, shown while the Elements are still being read. */
export const DEFAULT_MAP_TAB: ElementView = {
  id: MAP_TAB,
  project: null,
  kind: null,
  container: 'right-panel',
  properties: defaultOwnProperties(MAP_TAB),
  takes: PROPERTIES_TAKEN[MAP_TAB],
  contentKinds: [],
  items: [],
  attention: null
}

export interface RightPanelInput {
  /** ClaudeForge's own Elements and the displayed Project's Created Elements; null while they are read. */
  elements: readonly ElementView[] | null
  /** The Panel tab the user (or a Panel tab coming to the front) last chose in this Project. */
  chosen: string | null
  /** The Project has a Map to show, or a reason to say why it shows none. */
  hasMap: boolean
  /** The user expanded the panel though it had collapsed on its own. */
  openedAnyway: boolean
}

export interface RightPanelState {
  /** The Panel tabs in the header, the Map Panel tab first; hidden ones left out. */
  tabs: ElementView[]
  /** The Panel tab on show; null when there is none to show. */
  shown: ElementView | null
  /** The panel collapses on its own: neither a Map nor any other Panel tab to show. */
  autoCollapsed: boolean
}

export function rightPanelState({ elements, chosen, hasMap, openedAnyway }: RightPanelInput): RightPanelState {
  const shownTabs = inOrder((elements ?? [DEFAULT_MAP_TAB]).filter((element) => element.container === 'right-panel'))
    .filter((element) => element.properties.visible !== false)
  // Always the first, whatever order a Created Panel tab was given.
  const map = shownTabs.find((element) => element.id === MAP_TAB)
  const others = shownTabs.filter((element) => element.id !== MAP_TAB)
  const tabs = map ? [map, ...others] : others
  const mapToShow = hasMap ? map : undefined
  const shown = tabs.find((element) => element.id === chosen) ?? mapToShow ?? others[0] ?? map ?? null
  return { tabs, shown, autoCollapsed: elements !== null && !openedAnyway && !mapToShow && others.length === 0 }
}

/** The Panel tab to bring to the front: the last that asks to, as it was created or added to last. */
export const tabToBringForward = (tabs: readonly ElementView[]): string | null =>
  tabs.findLast((element) => element.attention === 'front')?.id ?? null

/** The Panel tabs the user now sees that still ask for attention: the one on show, while the panel is open. */
export const tabsToMarkSeen = (state: RightPanelState, { collapsed }: { collapsed: boolean }): ElementView[] =>
  !collapsed && state.shown && state.shown.attention !== null ? [state.shown] : []
