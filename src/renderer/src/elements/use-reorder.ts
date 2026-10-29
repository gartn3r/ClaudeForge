// Moving an Element among the others of its container by drag and drop: the explorer's cards by
// their head, the Right panel's Panel tabs by themselves. Where it would land shows on the Element
// it is dropped on; the drop asks the contract for the orders that change, kept as any order is.

import { useState, type DragEvent } from 'react'
import type { ElementView } from '../../../shared/elements'
import { askAll } from './ElementMenus'
import { dropRequests, landingPlace, takesOrder, type Landing } from './element-menus'

/** The data type a dragged Element carries, so that any other drag (a Shortcut's) passes the Elements by. */
const ELEMENT_DRAG_TYPE = 'application/x-claudeforge-element'

/** What an Element is dragged by. */
export interface GripProps {
  draggable: true
  'data-grip': ''
  onDragStart(event: DragEvent<HTMLElement>): void
  onDragEnd(): void
}

/** What an Element is dropped on: before or after it, as the pointer is in its first or second half. */
export interface DropZoneProps {
  'data-drop-zone': ''
  'data-landing'?: Landing['place']
  'data-dragged'?: true
  onDragOver(event: DragEvent<HTMLElement>): void
  onDragLeave(event: DragEvent<HTMLElement>): void
  onDrop(event: DragEvent<HTMLElement>): void
}

/** The drag and drop of one container's Elements. */
export interface Reorder {
  /** What the Element is dragged by; none for one that does not move among the others. */
  grip(element: ElementView): GripProps | undefined
  /** What another is dropped on; none for an Element that does not move among the others. */
  dropZone(element: ElementView): DropZoneProps | undefined
}

/**
 * Drag and drop among the Elements of one container, given in their order, hidden ones included;
 * `axis` is the way they follow one another: `y` down a column, `x` along a row.
 */
export function useReorder(siblings: readonly ElementView[], axis: 'x' | 'y'): Reorder {
  const [drag, setDrag] = useState<{ id: string; landing: Landing | null } | null>(null)
  const movesAmong = (element: ElementView): boolean => takesOrder(element) && siblings.some((each) => each.id === element.id)
  const isElementDrag = (event: DragEvent<HTMLElement>): boolean =>
    drag !== null && event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)

  const landingBy = (event: DragEvent<HTMLElement>, element: ElementView): Landing => ({
    id: element.id,
    place: landingPlace(event.currentTarget.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, axis)
  })

  return {
    grip: (element) =>
      movesAmong(element)
        ? {
            draggable: true,
            'data-grip': '',
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(ELEMENT_DRAG_TYPE, element.id)
              setDrag({ id: element.id, landing: null })
            },
            onDragEnd: () => setDrag(null)
          }
        : undefined,
    dropZone: (element) => {
      if (!movesAmong(element)) return undefined
      const landing = drag && drag.id !== element.id && drag.landing?.id === element.id ? drag.landing.place : undefined
      return {
        'data-drop-zone': '',
        ...(landing ? { 'data-landing': landing } : {}),
        ...(drag?.id === element.id ? { 'data-dragged': true } : {}),
        onDragOver: (event) => {
          if (!isElementDrag(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const next = landingBy(event, element)
          if (next.id !== drag!.landing?.id || next.place !== drag!.landing.place) setDrag({ ...drag!, landing: next })
        },
        // Out of it, and not into what it holds, a drop would land nowhere: where it would land shows no more.
        onDragLeave: (event) => {
          if (!isElementDrag(event) || drag!.landing?.id !== element.id) return
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setDrag({ ...drag!, landing: null })
        },
        onDrop: (event) => {
          if (!isElementDrag(event)) return
          event.preventDefault()
          const dragged = siblings.find((each) => each.id === drag!.id)
          if (dragged) void askAll(dropRequests(siblings, dragged, landingBy(event, element)))
          setDrag(null)
        }
      }
    }
  }
}
