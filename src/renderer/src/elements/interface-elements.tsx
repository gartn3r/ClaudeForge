import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import {
  OWN_CONTAINERS,
  PROPERTIES_TAKEN,
  defaultOwnProperties,
  inOrder,
  type Container,
  type ContentItem,
  type ElementView,
  type OwnElementId
} from '../../../shared/elements'
import { api } from '../api'
import { ContentItemMenu, ElementMenu } from './ElementMenus'
import { elementStyle } from './element-style'
import { useElements } from './use-elements'

/** What a piece of the window takes from the Element it is. */
export interface ElementFrame {
  id: string
  /** Its title as the user or Claude set it; null for ClaudeForge's own words. */
  title: string | null
  collapsed: boolean
  /** Its colours. */
  style: CSSProperties
  /** Opens its right-click menu, unless something inside already answered the right-click. */
  onContextMenu(event: MouseEvent): void
}

/** ClaudeForge's own Element as the Default layout has it, before the backend first lists it. */
const defaultView = (id: OwnElementId): ElementView => ({
  id,
  project: null,
  kind: null,
  container: OWN_CONTAINERS[id] ?? null,
  properties: defaultOwnProperties(id),
  takes: PROPERTIES_TAKEN[id],
  contentKinds: [],
  items: [],
  attention: null
})

/** The interface brought a Created Element to the front, or showed it: its mark goes. */
export const markSeen = (id: string, project: string | null): void =>
  void api.elements.request({ op: 'seen', ...(project === null ? {} : { project }), element: id }).catch(() => undefined)

/**
 * A side column's props from its Element's frame: its colours and its right-click menu; on its rail
 * only, for a column whose content answers right-clicks its own way.
 */
export const columnProps = (
  frame: ElementFrame,
  { railOnly = false } = {}
): { style: CSSProperties; onContextMenu(event: MouseEvent): void } => ({
  style: frame.style,
  onContextMenu: (event) => {
    if (!railOnly || !(event.target as Element).closest('.side-panel__body')) frame.onContextMenu(event)
  }
})

export const isShown = (element: ElementView): boolean => element.properties.visible !== false

type Opened =
  | { kind: 'element'; element: ElementView; at: { x: number; y: number }; siblings?: readonly ElementView[] }
  | { kind: 'item'; element: ElementView; item: ContentItem; at: { x: number; y: number } }

const openedKey = (opened: Opened): string =>
  [opened.element.id, opened.kind === 'item' ? opened.item.id : '', opened.at.x, opened.at.y].join(' ')

export interface InterfaceElements {
  /** One of ClaudeForge's own Elements, as it is now. */
  own(id: OwnElementId): ElementView
  /** The Elements a container holds, ClaudeForge's own and the displayed Project's, in their order. */
  inside(container: Container): ElementView[]
  /** What a piece of the window takes from its Element; given its container's, it can be moved among them. */
  frame(element: ElementView, siblings?: readonly ElementView[]): ElementFrame
  openItemMenu(element: ElementView, item: ContentItem, event: MouseEvent): void
  /** The right-click menu open, if any, and its dialogs. */
  menus: ReactNode
}

/** The window's Elements for the displayed Project, and their right-click menus. */
export function useInterfaceElements(project: string): InterfaceElements {
  const views = useElements(project)
  const [opened, setOpened] = useState<Opened | null>(null)
  const close = useCallback(() => setOpened(null), [])

  const own = (id: OwnElementId): ElementView => views?.find((view) => view.id === id) ?? defaultView(id)
  const inside = (container: Container): ElementView[] =>
    inOrder(
      (views ?? Object.keys(OWN_CONTAINERS).map((id) => defaultView(id as OwnElementId))).filter(
        (view) => view.container === container
      )
    )
  const at = (event: MouseEvent): { x: number; y: number } => ({ x: event.clientX, y: event.clientY })

  return {
    own,
    inside,
    frame: (element, siblings) => ({
      id: element.id,
      title: element.properties.title ?? null,
      collapsed: element.properties.collapsed === true,
      style: elementStyle(element.properties),
      onContextMenu: (event) => {
        if (event.defaultPrevented) return
        event.preventDefault()
        setOpened({ kind: 'element', element, at: at(event), siblings })
      }
    }),
    openItemMenu: (element, item, event) => {
      if (event.defaultPrevented) return
      event.preventDefault()
      setOpened({ kind: 'item', element, item, at: at(event) })
    },
    menus:
      opened?.kind === 'element' ? (
        // Each right-click opens a menu of its own, never the last one's dialog.
        <ElementMenu key={openedKey(opened)} element={opened.element} at={opened.at} siblings={opened.siblings} onClose={close} />
      ) : opened?.kind === 'item' ? (
        <ContentItemMenu key={openedKey(opened)} element={opened.element} item={opened.item} at={opened.at} onClose={close} />
      ) : null
  }
}
