import { Plus } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ElementView, OwnElementId } from '../../../shared/elements'
import { ContentItemView, type ItemHandlers } from './ContentItemView'
import { CreateElementDialog } from './ElementMenus'
import { isShown, markSeen, type ElementFrame, type InterfaceElements } from './interface-elements'
import { useReorder } from './use-reorder'

/** ClaudeForge's own cards of the explorer, each drawn by the window around it with its frame. */
type OwnCards = Record<Extract<OwnElementId, 'shortcuts' | 'sessions' | 'extensions'>, (frame: ElementFrame) => ReactNode>

interface ExplorerColumnProps extends OwnCards {
  elements: InterfaceElements
  /** The displayed Project, whose cards show. */
  project: string
  onType: ItemHandlers['type']
}

/**
 * The explorer's cards in their order: the Shortcuts, the Sessions and the Extensions, and the
 * displayed Project's Created cards, those hidden left out; then the + that creates a card. A card
 * dragged by its head moves among the others.
 */
export function ExplorerColumn({ elements, project, onType, ...own }: ExplorerColumnProps): ReactNode {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const cards = elements.inside('explorer')
  const reorder = useReorder(cards, 'y')
  const frameOf = (element: ElementView): ElementFrame => ({
    ...elements.frame(element, cards),
    grip: reorder.grip(element),
    dropZone: reorder.dropZone(element)
  })
  return (
    <>
      {cards.filter(isShown).map((element) => (
        <Fragment key={element.id}>
          {element.kind === 'card' ? (
            <CreatedCard element={element} elements={elements} frame={frameOf(element)} onType={onType} />
          ) : element.id in own ? (
            own[element.id as keyof OwnCards](frameOf(element))
          ) : null}
        </Fragment>
      ))}
      <button type="button" className="cf-btn cf-btn--ghost explorer__new-card" onClick={() => setCreating(true)}>
        <Plus className="cf-icon cf-icon--sm" aria-hidden="true" />
        {t('elements.card.new')}
      </button>
      {creating && createPortal(<CreateElementDialog kind="card" project={project} onDone={() => setCreating(false)} />, document.body)}
    </>
  )
}

interface CreatedCardProps {
  element: ElementView
  elements: InterfaceElements
  frame: ElementFrame
  onType: ItemHandlers['type']
}

/**
 * A card created in the explorer: its title and identifier, then its texts, links, files (as links)
 * and actions. New, it comes into view; changed, it shows a mark until the pointer or the focus
 * reaches it.
 */
function CreatedCard({ element, elements, frame, onType }: CreatedCardProps): ReactNode {
  const { t } = useTranslation()
  const headingId = useId()
  const card = useRef<HTMLElement>(null)
  const { id, project, attention } = element

  useEffect(() => {
    if (attention !== 'front') return
    card.current?.scrollIntoView({ block: 'nearest' })
    markSeen(id, project)
  }, [attention, id, project])

  const seenIfMarked = (): void => {
    if (attention === 'mark') markSeen(id, project)
  }

  return (
    <section
      ref={card}
      className="element-card cf-tile cf-tile--card"
      data-element={element.id}
      data-collapsed={frame.collapsed}
      aria-labelledby={headingId}
      style={frame.style}
      onContextMenu={frame.onContextMenu}
      onPointerEnter={seenIfMarked}
      onFocus={seenIfMarked}
      {...frame.dropZone}
    >
      <div className="element-card__head" {...frame.grip}>
        <h2 className="cf-heading" id={headingId}>
          {frame.title ?? element.id}
        </h2>
        {attention === 'mark' && <span className="element-mark" role="img" aria-label={t('elements.mark')} />}
        <span className="element-card__id cf-mono">{element.id}</span>
      </div>
      {!frame.collapsed &&
        (element.items.length ? (
          <ul className="element-card__items">
            {element.items.map((item) => (
              <li key={item.id} onContextMenu={(event) => elements.openItemMenu(element, item, event)}>
                <ContentItemView element={element} item={item} onType={onType} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="element-card__empty">{t('elements.card.empty')}</p>
        ))}
    </section>
  )
}
