import { ExternalLink } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Ticket, WayfinderMap } from '../../../shared/api'
import { api } from '../api'
import { openBlockerNames, waitsOnlyForParent, type TFunction } from './MapGraph'
import { MapText } from './MapText'

interface TicketDetailsProps {
  map: WayfinderMap
  ticket: Ticket
  onClose(): void
}

/** Why a Ticket cannot be started: what blocks it, or who claimed it; null when nothing does. */
function blockingReason(t: TFunction, map: WayfinderMap, ticket: Ticket): string | null {
  if (ticket.state === 'blocked') {
    if (waitsOnlyForParent(ticket)) return t('map.details.parentWaits')
    const blockers = openBlockerNames(map, ticket)
    // A blocker outside the Map has no name here.
    if (blockers.length === 0) return t('map.details.blockedOutside', { count: ticket.openBlockers })
    return t('map.details.blockedBy', { blockers: blockers.join(', ') })
  }
  if (ticket.state === 'claimed' && !ticket.workable) {
    return ticket.assignee ? t('map.details.claimedBy', { assignee: ticket.assignee }) : t('map.details.claimed')
  }
  return null
}

/**
 * A Ticket that cannot be started from the Map: its question, its answer once closed, why it
 * waits, and its issue to open where the Tracker keeps it. Escape closes it.
 */
export function TicketDetails({ map, ticket, onClose }: TicketDetailsProps): ReactNode {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const questionId = useId()
  const answerId = useId()
  const reason = blockingReason(t, map, ticket)
  const state = t(`map.state.${ticket.state}`)
  const [openFailed, setOpenFailed] = useState(false)
  const openIssue = (): void => {
    setOpenFailed(false)
    api.map.openIssue(ticket.path).catch(() => setOpenFailed(true))
  }

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="cf-dialog ticket-details"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 className="cf-dialog__title" id={titleId}>
        {ticket.name}
      </h2>
      <p className="ticket-details__state cf-muted">
        {ticket.type ? `${t(`map.type.${ticket.type}`)} · ${state}` : state}
      </p>
      <section className="ticket-details__part" aria-labelledby={questionId}>
        <span className="cf-eyebrow" id={questionId}>
          {t('map.question')}
        </span>
        {ticket.question ? <MapText markdown={ticket.question} /> : <p className="cf-muted">{t('map.sectionEmpty')}</p>}
      </section>
      {!ticket.open && ticket.answer && (
        <section className="ticket-details__part" aria-labelledby={answerId}>
          <span className="cf-eyebrow" id={answerId}>
            {t('map.details.answer')}
          </span>
          <MapText markdown={ticket.answer} />
        </section>
      )}
      {reason && <p className="ticket-details__reason">{reason}</p>}
      {openFailed && (
        <p className="ticket-details__error" role="alert">
          {t('map.details.openFailed')}
        </p>
      )}
      <div className="cf-dialog__actions">
        <button type="button" className="cf-btn" onClick={openIssue}>
          <ExternalLink className="cf-icon" aria-hidden="true" />
          {t('map.openIssue')}
        </button>
        <button type="button" className="cf-btn cf-btn--primary" autoFocus onClick={onClose}>
          {t('dialog.close')}
        </button>
      </div>
    </dialog>
  )
}
