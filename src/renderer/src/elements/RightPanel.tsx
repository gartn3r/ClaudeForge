import { Map as MapIcon, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentItem, ElementView } from '../../../shared/elements'
import { api, onEvent } from '../api'
import { IconButton } from '../components/IconButton'
import { samePath } from '../terminal/typing'
import { ContentItemView, type ItemHandlers } from './ContentItemView'
import { CreateElementDialog } from './CreateElementDialog'
import { ContentItemMenu, ElementMenu } from './ElementMenus'
import { MAP_TAB, rightPanelState, tabToBringForward, tabsToMarkSeen, type RightPanelState } from './right-panel'

/** A Panel tab's name: its title, the Map Panel tab's own words by default. */
export function useTabName(): (tab: ElementView) => string {
  const { t } = useTranslation()
  return (tab) => tab.properties.title ?? (tab.id === MAP_TAB ? t('map.label') : tab.id)
}

/**
 * The Right panel's words, after the Panel tab on show: the Map panel's own while the Map shows, so
 * the panel reads as it always did.
 */
export function useRightPanelLabels(shown: ElementView | null): { label: string; collapse: string; expand: string; resize: string } {
  const { t } = useTranslation()
  const tabName = useTabName()
  const words = shown?.id === MAP_TAB ? 'map' : 'rightPanel'
  return {
    label: shown ? tabName(shown) : t('rightPanel.label'),
    collapse: t(`${words}.collapse`),
    expand: t(`${words}.expand`),
    resize: t(`${words}.resize`)
  }
}

/** An Element's own colours, where it sets them. */
const coloursOf = ({ properties }: ElementView): CSSProperties => ({
  ...(properties.textColor ? { color: properties.textColor } : {}),
  ...(properties.backgroundColor ? { background: properties.backgroundColor } : {})
})

/**
 * ClaudeForge's own Elements and the Project's Created Elements, as the contract lists them, listed
 * again whenever the backend says they changed; null until the Project's are read.
 */
export function useElements(project: string): ElementView[] | null {
  const [listed, setListed] = useState<{ project: string; elements: ElementView[] } | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      onEvent('elements.changed', (change) => {
        if (change.project === null || samePath(change.project, project)) setRevision((each) => each + 1)
      }),
    [project]
  )
  useEffect(() => {
    let current = true
    api.elements.request({ op: 'list', project }).then(
      (result) => current && result.ok && setListed({ project, elements: result.elements }),
      () => undefined
    )
    return () => {
      current = false
    }
  }, [project, revision])
  return listed?.project === project ? listed.elements : null
}

interface UseRightPanel {
  project: string
  elements: ElementView[] | null
  hasMap: boolean
  /** As the user left the panel in the app state's layout. */
  layoutCollapsed: boolean
  /** Expands the panel as the user would, so a Panel tab that comes to the front shows. */
  expand(): void
}

/**
 * The Right panel's state for the displayed Project: the Panel tab on show, chosen by the user or
 * brought to the front, and whether the panel shows at all. The Panel tab the user sees loses its mark.
 */
export function useRightPanel({ project, elements, hasMap, layoutCollapsed, expand }: UseRightPanel): {
  state: RightPanelState
  collapsed: boolean
  choose(id: string): void
  openAnyway(): void
} {
  // A choice, and opening the panel anyway, hold until the Project changes.
  const [chosen, setChosen] = useState<{ project: string; id: string } | null>(null)
  const [openedAnyway, setOpenedAnyway] = useState<string | null>(null)
  const state = rightPanelState({
    elements,
    chosen: chosen?.project === project ? chosen.id : null,
    hasMap,
    openedAnyway: openedAnyway === project
  })
  const collapsed = layoutCollapsed || state.autoCollapsed

  // A Panel tab that asks to come to the front is chosen, as if the user had clicked it, once.
  const forward = tabToBringForward(state.tabs)
  const forwardKey = forward && `${project}\n${forward}`
  const [broughtForward, setBroughtForward] = useState<string | null>(null)
  if (forwardKey !== broughtForward) {
    setBroughtForward(forwardKey)
    if (forward) setChosen({ project, id: forward })
  }
  useEffect(() => {
    if (forward && layoutCollapsed) expand()
  }, [forward, layoutCollapsed, expand])

  const seen = tabsToMarkSeen(state, { collapsed })
    .map((tab) => tab.id)
    .join(' ')
  useEffect(() => {
    for (const element of seen ? seen.split(' ') : []) {
      void api.elements.request({ op: 'seen', project, element }).catch(() => undefined)
    }
  }, [project, seen])

  return {
    state,
    collapsed,
    choose: (id) => setChosen({ project, id }),
    openAnyway: () => setOpenedAnyway(project)
  }
}

type OpenMenu =
  | { element: ElementView; item?: undefined; at: { x: number; y: number } }
  | { element: ElementView; item: ContentItem; at: { x: number; y: number } }

interface RightPanelProps {
  state: RightPanelState
  /** The displayed Project, where **+** creates a Panel tab. */
  project: string
  /** What the Map Panel tab shows: the Map panel, as it always was. */
  map: ReactNode
  collapseLabel: string
  onChoose(id: string): void
  onCollapse(): void
  onType: ItemHandlers['type']
}

/**
 * The Right panel: its Panel tabs in its header, the Map first, then a **+** that creates one; under
 * them the Panel tab on show. Right-click on a Panel tab or a Content item opens its menu.
 */
export function RightPanel({ state, project, map, collapseLabel, onChoose, onCollapse, onType }: RightPanelProps): ReactNode {
  const { t } = useTranslation()
  const tabName = useTabName()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [creating, setCreating] = useState(false)
  const { shown } = state
  const openMenu = (event: MouseEvent, element: ElementView, item?: ContentItem): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ element, item, at: { x: event.clientX, y: event.clientY } } as OpenMenu)
  }
  const closeMenu = (): void => setMenu(null)

  return (
    <>
      <div className="right-panel__head">
        <div className="right-panel__tabs" role="tablist" aria-label={t('rightPanel.tabs')}>
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`panel-tab-${tab.id}`}
              className="cf-tab right-panel__tab"
              aria-selected={tab.id === shown?.id}
              aria-controls={tab.id === shown?.id ? 'right-panel-shown' : undefined}
              style={coloursOf(tab)}
              onClick={() => onChoose(tab.id)}
              onContextMenu={(event) => openMenu(event, tab)}
            >
              {tab.id === MAP_TAB && <MapIcon className="cf-icon cf-icon--sm" aria-hidden="true" />}
              <span className="cf-tab__title">{tabName(tab)}</span>
              {tab.attention === 'mark' && tab.id !== shown?.id && (
                <span className="cf-dot right-panel__mark" role="img" aria-label={t('rightPanel.changed')} />
              )}
            </button>
          ))}
          <button
            type="button"
            className="cf-btn cf-btn--add cf-btn--icon right-panel__new"
            aria-label={t('rightPanel.new')}
            title={t('rightPanel.new')}
            onClick={() => setCreating(true)}
          >
            <Plus className="cf-icon" aria-hidden="true" />
          </button>
        </div>
        <IconButton icon={PanelRightClose} label={collapseLabel} onClick={onCollapse} />
      </div>
      {shown && (
        // Not a tabpanel: the Hosted session on show is the window's one. The panel is named after the Panel tab on show.
        <div className="right-panel__shown" id="right-panel-shown">
          {shown.id === MAP_TAB ? (
            map
          ) : (
            <PanelTabView tab={shown} onType={onType} onMenu={openMenu} />
          )}
        </div>
      )}
      {menu &&
        (menu.item ? (
          <ContentItemMenu element={menu.element} item={menu.item} at={menu.at} onClose={closeMenu} />
        ) : (
          <ElementMenu element={menu.element} at={menu.at} onClose={closeMenu} />
        ))}
      {creating && <CreateElementDialog kind="panel-tab" project={project} onDone={() => setCreating(false)} />}
    </>
  )
}

interface PanelTabViewProps {
  tab: ElementView
  onType: ItemHandlers['type']
  onMenu(event: MouseEvent, element: ElementView, item?: ContentItem): void
}

/** A Created Panel tab: its title and identifier, then its Content items, every kind shown in full. */
function PanelTabView({ tab, onType, onMenu }: PanelTabViewProps): ReactNode {
  const { t } = useTranslation()
  const tabName = useTabName()
  return (
    <div className="panel-tab" style={coloursOf(tab)} onContextMenu={(event) => onMenu(event, tab)}>
      <header className="panel-tab__head">
        <h2 className="cf-heading panel-tab__title">{tabName(tab)}</h2>
        <span className="cf-mono panel-tab__id">{tab.id}</span>
      </header>
      {tab.items.length ? (
        <ul className="panel-tab__items" aria-label={tabName(tab)}>
          {tab.items.map((item) => (
            <li key={item.id} className="panel-tab__item" onContextMenu={(event) => onMenu(event, tab, item)}>
              <ContentItemView element={tab} item={item} onType={onType} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty panel-tab__empty">{t('rightPanel.empty')}</p>
      )}
    </div>
  )
}

interface RightPanelRailProps {
  label: string
  /** A Panel tab's content changed while the panel was collapsed. */
  marked: boolean
  onExpand(): void
}

/** The collapsed Right panel: a button that expands it, marked while a Panel tab holds a change. */
export function RightPanelRail({ label, marked, onExpand }: RightPanelRailProps): ReactNode {
  const { t } = useTranslation()
  return (
    <div className="right-panel__rail">
      <IconButton icon={PanelRightOpen} label={label} onClick={onExpand} />
      {marked && <span className="cf-dot right-panel__mark" role="img" aria-label={t('rightPanel.changed')} />}
    </div>
  )
}
