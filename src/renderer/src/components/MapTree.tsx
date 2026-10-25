import { Check, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { Ticket, WayfinderMap } from '../../../shared/api'
import { RollupBar, openBlockerNames, ticketTooltip, waitsOnlyForParent } from './MapGraph'

interface MapTreeProps {
  map: WayfinderMap
  /** Leaves out closed Tickets with nothing open beneath them. */
  hideClosed: boolean
  onHideClosed(hide: boolean): void
  /** Ids of the Tickets whose Sub-tickets are folded away. */
  folded: string[]
  onFold(ticketId: string, folded: boolean): void
  /** Opens a Parent Ticket in the graph. */
  onOpen(ticketId: string): void
}

/** One shown row: a Ticket, how deep it sits and whether it shows Sub-tickets. */
interface TreeRow {
  ticket: Ticket
  depth: number
  hasSubTickets: boolean
}

/** The shown rows, depth first in Map order, skipping what is folded or hidden. */
function treeRows(map: WayfinderMap, hideClosed: boolean, folded: Set<string>): TreeRow[] {
  const subTickets = new Map<string | null, Ticket[]>()
  for (const ticket of map.tickets) subTickets.set(ticket.parent, [...(subTickets.get(ticket.parent) ?? []), ticket])
  const holdsOpen = (ticket: Ticket): boolean => ticket.open || (subTickets.get(ticket.id) ?? []).some(holdsOpen)
  const shown = (parent: string | null): Ticket[] =>
    (subTickets.get(parent) ?? []).filter((ticket) => !hideClosed || holdsOpen(ticket))
  const walk = (parent: string | null, depth: number): TreeRow[] =>
    shown(parent).flatMap((ticket) => {
      const hasSubTickets = shown(ticket.id).length > 0
      const row = { ticket, depth, hasSubTickets }
      return hasSubTickets && !folded.has(ticket.id) ? [row, ...walk(ticket.id, depth + 1)] : [row]
    })
  return walk(null, 0)
}

/**
 * The whole Ticket hierarchy of a Map as one indented list, with a switch to hide closed Tickets.
 * The arrow keys move between rows, fold and unfold them; Enter opens a Parent Ticket in the graph.
 */
export function MapTree({ map, hideClosed, onHideClosed, folded, onFold, onOpen }: MapTreeProps): ReactNode {
  const { t } = useTranslation()
  const switchId = useId()
  const list = useRef<HTMLUListElement>(null)
  const foldedSet = new Set(folded)
  const rows = treeRows(map, hideClosed, foldedSet)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // The row the Tab key reaches: the last one focused while it shows, else the first.
  const tabbable = rows.find((row) => row.ticket.id === focusedId) ?? rows[0]
  const count = (state: Ticket['state']): number => map.tickets.filter((ticket) => ticket.state === state).length
  const closed = map.tickets.filter((ticket) => !ticket.open).length

  const focusRow = (row: TreeRow | undefined): void => {
    if (!row) return
    setFocusedId(row.ticket.id)
    list.current?.querySelector<HTMLElement>(`[data-ticket="${CSS.escape(row.ticket.id)}"]`)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    const index = rows.findIndex((row) => row.ticket.id === focusedId)
    const row = rows[index]
    if (!row) return
    const isFolded = foldedSet.has(row.ticket.id)
    if (event.key === 'ArrowDown') focusRow(rows[index + 1])
    else if (event.key === 'ArrowUp') focusRow(rows[index - 1])
    else if (event.key === 'Home') focusRow(rows[0])
    else if (event.key === 'End') focusRow(rows.at(-1))
    else if (event.key === 'ArrowRight' && row.hasSubTickets) {
      if (isFolded) onFold(row.ticket.id, false)
      else focusRow(rows[index + 1])
    } else if (event.key === 'ArrowLeft') {
      if (row.hasSubTickets && !isFolded) onFold(row.ticket.id, true)
      else focusRow(rows.find((each) => each.ticket.id === row.ticket.parent))
    } else if (event.key === 'Enter' && row.ticket.rollup) onOpen(row.ticket.id)
    else return
    event.preventDefault()
  }

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
        <ul ref={list} className="map-tree__rows" role="tree" aria-label={t('map.tree.label')} onKeyDown={onKeyDown}>
          {rows.map((row) => (
            <TreeItem
              key={row.ticket.id}
              map={map}
              row={row}
              folded={foldedSet.has(row.ticket.id)}
              tabbable={row === tabbable}
              onFocus={() => setFocusedId(row.ticket.id)}
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
  /** The row the Tab key reaches; the others are reached with the arrow keys. */
  tabbable: boolean
  onFocus(): void
  onFold(ticketId: string, folded: boolean): void
  onOpen(ticketId: string): void
}

/**
 * One Ticket: indent guides, a twisty when it has Sub-tickets, its state, its name (opening a
 * Parent Ticket in the graph) and on the right what to know of it: a roll-up, the Frontier, who
 * claimed it or why it waits.
 */
function TreeItem({
  map,
  row: { ticket, depth, hasSubTickets },
  folded,
  tabbable,
  onFocus,
  onFold,
  onOpen
}: TreeItemProps): ReactNode {
  const { t } = useTranslation()
  const nameId = useId()
  const metaId = useId()
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
      tabIndex={tabbable ? 0 : -1}
      data-ticket={ticket.id}
      aria-level={depth + 1}
      aria-expanded={hasSubTickets ? !folded : undefined}
      aria-labelledby={nameId}
      aria-describedby={metaId}
      title={ticketTooltip(t, ticket, blockers)}
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
    >
      {depth > 0 && (
        <span className="cf-indent" aria-hidden="true">
          {Array.from({ length: depth }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      )}
      <span className="cf-twisty">
        {hasSubTickets && (
          <button
            type="button"
            tabIndex={-1}
            className="map-tree__twisty"
            aria-label={t('map.tree.subTickets', { name: ticket.name })}
            onClick={() => onFold(ticket.id, !folded)}
          >
            <Twisty className="cf-icon cf-icon--sm" aria-hidden="true" />
          </button>
        )}
      </span>
      {glyph}
      {rollup ? (
        <button
          id={nameId}
          type="button"
          tabIndex={-1}
          className={`${nameClass} map-tree__open`}
          onClick={() => onOpen(ticket.id)}
        >
          {ticket.name}
        </button>
      ) : (
        <span id={nameId} className={nameClass}>
          {ticket.name}
        </span>
      )}
      <span id={metaId} className="map-tree__meta">
        {claim}
        {meta}
      </span>
    </li>
  )
}
