import { Check, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { Ticket, WayfinderMap } from '../../../shared/api'
import { RollupBar, openBlockerNames, ticketTooltip, waitsOnlyForParent } from './MapGraph'

interface MapTreeProps {
  map: WayfinderMap
  /** Leaves closed Tickets, and everything beneath them, out. */
  hideClosed: boolean
  onHideClosed(hide: boolean): void
  /** Ids of the Tickets whose Sub-tickets are folded away. */
  folded: string[]
  onFold(ticketId: string, folded: boolean): void
  /** Opens a Parent Ticket in the graph. */
  onOpen(ticketId: string): void
}

/** One shown row: a Ticket, how deep it sits and whether it has shown Sub-tickets. */
interface TreeRow {
  ticket: Ticket
  depth: number
  hasChildren: boolean
}

/** The shown rows, depth first in Map order, skipping what is folded or hidden. */
function treeRows(map: WayfinderMap, hideClosed: boolean, folded: Set<string>): TreeRow[] {
  const children = (parent: string | null): Ticket[] =>
    map.tickets.filter((ticket) => ticket.parent === parent && (!hideClosed || ticket.open))
  const walk = (parent: string | null, depth: number): TreeRow[] =>
    children(parent).flatMap((ticket) => {
      const hasChildren = children(ticket.id).length > 0
      const row = { ticket, depth, hasChildren }
      return hasChildren && !folded.has(ticket.id) ? [row, ...walk(ticket.id, depth + 1)] : [row]
    })
  return walk(null, 0)
}

/** The whole Ticket hierarchy of a Map as one indented list, with a switch to hide closed Tickets. */
export function MapTree({ map, hideClosed, onHideClosed, folded, onFold, onOpen }: MapTreeProps): ReactNode {
  const { t } = useTranslation()
  const switchId = useId()
  const rows = treeRows(map, hideClosed, new Set(folded))
  const count = (state: Ticket['state']): number => map.tickets.filter((ticket) => ticket.state === state).length
  const closed = map.tickets.filter((ticket) => !ticket.open).length

  return (
    <div className="map-tree">
      <div className="map-tree__head">
        <span className="cf-rollup-text" role="status" aria-label={t('map.counts')}>
          <Trans i18nKey="map.rollup.frontier" values={{ count: count('frontier') }} components={{ b: <b /> }} />
          {' · '}
          {t('map.rollup.claimed', { count: count('claimed') })}
          {' · '}
          {t('map.rollup.closed', { closed, total: map.tickets.length })}
        </span>
        <label className="map-tree__switch" htmlFor={switchId}>
          {t('map.tree.hideClosed')}
        </label>
        <button
          id={switchId}
          type="button"
          className="cf-toggle"
          role="switch"
          aria-checked={hideClosed}
          aria-label={t('map.tree.hideClosedTickets')}
          onClick={() => onHideClosed(!hideClosed)}
        />
      </div>
      {rows.length === 0 ? (
        <p className="empty">{t('map.allDecided')}</p>
      ) : (
        <ul className="map-tree__rows" role="tree" aria-label={t('map.tree.label')}>
          {rows.map((row) => (
            <TreeItem
              key={row.ticket.id}
              map={map}
              row={row}
              folded={folded.includes(row.ticket.id)}
              onFold={onFold}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface TreeItemProps {
  map: WayfinderMap
  row: TreeRow
  folded: boolean
  onFold(ticketId: string, folded: boolean): void
  onOpen(ticketId: string): void
}

/**
 * One Ticket: indent guides, a twisty when it has Sub-tickets, its state, its name (opening a
 * Parent Ticket in the graph) and on the right what to know of it: a roll-up, the Frontier, who
 * claimed it or why it waits.
 */
function TreeItem({ map, row: { ticket, depth, hasChildren }, folded, onFold, onOpen }: TreeItemProps): ReactNode {
  const { t } = useTranslation()
  const blockers = openBlockerNames(map, ticket)
  const { rollup } = ticket
  const Twisty = folded ? ChevronRight : ChevronDown

  let glyph: ReactNode = null
  let meta: ReactNode = null
  if (ticket.state === 'closed') {
    glyph = (
      <span className="map-tree__state map-tree__state--closed" role="img" aria-label={t('map.state.closed')}>
        <Check className="cf-icon cf-icon--sm" aria-hidden="true" />
      </span>
    )
  } else if (ticket.state === 'blocked') {
    const parentWaits = waitsOnlyForParent(ticket)
    glyph = (
      <span className="map-tree__state" role="img" aria-label={t(parentWaits ? 'map.state.parentWaits' : 'map.state.blocked')}>
        <Lock className="cf-icon cf-icon--sm" aria-hidden="true" />
      </span>
    )
    meta = (
      <span className="cf-tree-meta">
        {parentWaits ? t('map.tree.parentWaits') : t('map.tree.after', { blockers: blockers.join(', ') })}
      </span>
    )
  } else if (rollup) {
    meta = (
      <>
        <RollupBar rollup={rollup} />
        <span className="cf-tree-meta">{`${rollup.closed}/${rollup.total}`}</span>
      </>
    )
  } else if (ticket.state === 'frontier') {
    meta = <span className="cf-frontier-pill">{t('map.state.frontier')}</span>
  }
  const claim = ticket.open && ticket.claimed && ticket.state !== 'blocked' && (
    <span className="cf-status map-tree__claim" title={t('map.state.claimed')}>
      <span className="cf-dot" />
      {ticket.workable ? t('map.tree.you') : (ticket.assignee ?? t('map.state.claimed'))}
    </span>
  )

  const nameClass = ticket.open && ticket.state !== 'blocked' ? 'cf-tree-name' : 'cf-tree-name cf-muted'
  return (
    <li
      className={rollup ? 'cf-tree-row map-tree__row map-tree__row--parent' : 'cf-tree-row map-tree__row'}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? !folded : undefined}
      aria-label={ticket.name}
      title={ticketTooltip(t, ticket, blockers)}
    >
      {depth > 0 && (
        <span className="cf-indent" aria-hidden="true">
          {Array.from({ length: depth }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      )}
      <span className="cf-twisty">
        {hasChildren && (
          <button
            type="button"
            className="map-tree__twisty"
            aria-label={t('map.tree.subTickets', { name: ticket.name })}
            aria-expanded={!folded}
            onClick={() => onFold(ticket.id, !folded)}
          >
            <Twisty className="cf-icon cf-icon--sm" aria-hidden="true" />
          </button>
        )}
      </span>
      {glyph}
      {rollup ? (
        <button type="button" className={`${nameClass} map-tree__open`} onClick={() => onOpen(ticket.id)}>
          {ticket.name}
        </button>
      ) : (
        <span className={nameClass}>{ticket.name}</span>
      )}
      {claim}
      {meta}
    </li>
  )
}
