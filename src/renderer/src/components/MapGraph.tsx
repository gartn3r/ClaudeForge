import '@xyflow/react/dist/base.css'
import {
  ReactFlow,
  ViewportPortal,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps
} from '@xyflow/react'
import {
  Check,
  ChevronRight,
  Lock,
  Maximize,
  MessagesSquare,
  Minus,
  Plus,
  Search,
  Shapes,
  SquareCheck,
  SquareTerminal
} from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { SessionSummary, Ticket, TicketRollup, TicketState, TicketType, WayfinderMap } from '../../../shared/api'
import { TICKET_WIDTH, layoutMap, type MapLayout } from '../map/layout'
import { IconButton } from './IconButton'

type TFunction = ReturnType<typeof useTranslation>['t']

const TYPE_ICONS: Record<TicketType, typeof Search> = {
  research: Search,
  prototype: Shapes,
  grilling: MessagesSquare,
  task: SquareCheck
}

/** A Parent Ticket shows its Sub-ticket count instead of a glyph of its own. */
const STATE_GLYPHS: Record<Exclude<TicketState, 'parent'>, ReactNode> = {
  frontier: <ChevronRight className="cf-icon cf-icon--sm" aria-hidden="true" />,
  claimed: <span className="cf-dot" style={{ background: 'var(--route)' }} />,
  blocked: <Lock className="cf-icon cf-icon--sm" aria-hidden="true" />,
  closed: <Check className="cf-icon cf-icon--sm" aria-hidden="true" />
}

/** The order of the counts line; a Parent Ticket counts through the Tickets beneath it. */
const COUNTED_STATES: readonly Exclude<TicketState, 'parent'>[] = ['frontier', 'claimed', 'blocked', 'closed']

/** Space kept around the graph when it is placed in or fitted to the panel. */
const PADDING = 12
const ZOOM_DURATION = 120

type TicketCardData = {
  ticket: Ticket
  /** The names of its open blockers. */
  blockers: string[]
  /** The displayed Session works on this Ticket. */
  current: boolean
  /** The other Sessions working on it, each a badge that displays it. */
  sessions: SessionSummary[]
  onDisplaySession(id: string): void
  /** Opens a Parent Ticket: the graph then shows its Sub-tickets. */
  onOpen(id: string): void
}
type TicketCardNode = Node<TicketCardData, 'ticket'>

/** Blocked by an ancestor's open blocker alone ("parent waits"). */
export const waitsOnlyForParent = (ticket: Ticket): boolean =>
  ticket.state === 'blocked' && ticket.parentWaits && ticket.openBlockers === 0

/** The state glyph, with the open-blocker count when several open Tickets block it. */
function StateGlyph({ ticket }: { ticket: Ticket & { state: Exclude<TicketState, 'parent'> } }): ReactNode {
  const { t } = useTranslation()
  const several = ticket.state === 'blocked' && ticket.openBlockers > 1
  let label = t(`map.state.${ticket.state}`)
  if (several) label = t('map.state.blockedBy', { count: ticket.openBlockers })
  else if (waitsOnlyForParent(ticket)) label = t('map.state.parentWaits')
  return (
    <span className="cf-ticket__state cf-status" role="img" aria-label={label}>
      {STATE_GLYPHS[ticket.state]}
      {several && <span aria-hidden="true">{ticket.openBlockers}</span>}
    </span>
  )
}

/**
 * What lies beneath a Parent Ticket: a bar of its closed, claimed and Frontier descendants
 * and a line counting them, or what it waits for while it is blocked.
 */
export function Rollup({ ticket, blockers }: { ticket: Ticket; blockers: string[] }): ReactNode {
  const { t } = useTranslation()
  const rollup = ticket.rollup
  if (!rollup) return null
  let line: ReactNode
  if (waitsOnlyForParent(ticket)) line = t('map.rollup.parentWaits')
  else if (ticket.state === 'blocked') line = t('map.rollup.waitsFor', { blockers: blockers.join(', ') })
  else {
    // What can start beneath it, else what is under way, then how much is decided.
    const parts: ReactNode[] = []
    if (rollup.frontier > 0) {
      parts.push(<Trans key="frontier" i18nKey="map.rollup.frontier" values={{ count: rollup.frontier }} components={{ b: <b /> }} />)
    } else if (rollup.claimed > 0) parts.push(t('map.rollup.claimed', { count: rollup.claimed }))
    parts.push(t('map.rollup.closed', { closed: rollup.closed, total: rollup.total }))
    line = parts.flatMap((part, index) => (index > 0 ? [' · ', part] : [part]))
  }
  return (
    <>
      <RollupBar rollup={rollup} />
      <span className="cf-rollup-text">{line}</span>
    </>
  )
}

/** The bar of a Parent Ticket's closed, claimed and Frontier descendants. */
export function RollupBar({ rollup }: { rollup: TicketRollup }): ReactNode {
  const share = (count: number): string => `${(100 * count) / rollup.total}%`
  return (
    <span className="cf-rollup" aria-hidden="true">
      <i className="r-closed" style={{ width: share(rollup.closed) }} />
      <i className="r-claimed" style={{ width: share(rollup.claimed) }} />
      <i className="r-front" style={{ width: share(rollup.frontier) }} />
    </span>
  )
}

/** A Ticket's tooltip: its full name and state, with what blocks it or how many Sub-tickets it holds. */
export function ticketTooltip(t: TFunction, ticket: Ticket, blockers: string[]): string {
  if (waitsOnlyForParent(ticket)) return t('map.tooltip.parentWaits', { name: ticket.name })
  if (ticket.state === 'blocked') return t('map.tooltip.blocked', { name: ticket.name, blockers: blockers.join(', ') })
  return t(`map.tooltip.${ticket.state}`, { name: ticket.name, count: ticket.rollup?.subTickets })
}

/**
 * A compact Ticket: type, state glyph and name; the full name and any block in its tooltip.
 * A Parent Ticket is a stack with its Sub-ticket count and roll-up, opened by a click.
 */
function TicketCard({
  data: { ticket, blockers, current, sessions, onDisplaySession, onOpen }
}: NodeProps<TicketCardNode>): ReactNode {
  const { t } = useTranslation()
  const TypeIcon = ticket.type ? TYPE_ICONS[ticket.type] : null
  const { rollup } = ticket
  const tooltip = ticketTooltip(t, ticket, blockers)
  const classes = ['cf-ticket', 'cf-ticket--compact', `cf-ticket--${ticket.state}`, 'map-ticket']
  if (rollup) classes.push('cf-ticket--parent')
  if (current) classes.push('cf-ticket--current')
  const glyph = ticket.state === 'parent' ? null : <StateGlyph ticket={{ ...ticket, state: ticket.state }} />
  return (
    <div className={classes.join(' ')} title={tooltip}>
      {rollup && (
        <button
          type="button"
          className="map-ticket__open nopan"
          aria-label={t('map.open', { name: ticket.name })}
          onClick={() => onOpen(ticket.id)}
        />
      )}
      <span className="cf-ticket__head">
        {ticket.type && TypeIcon ? (
          <span className="cf-ticket__type">
            <TypeIcon className="cf-icon cf-icon--sm" aria-hidden="true" />
            {t(`map.type.${ticket.type}`)}
          </span>
        ) : (
          <span />
        )}
        {rollup ? (
          <span className="map-ticket__status">
            {glyph}
            <span className="cf-chip">{t('map.subTickets', { count: rollup.subTickets })}</span>
          </span>
        ) : (
          glyph
        )}
      </span>
      <span className="cf-ticket__name">{ticket.name}</span>
      <Rollup ticket={ticket} blockers={blockers} />
      {sessions.length > 0 && (
        <span className="cf-ticket__foot">
          {sessions.map((session) => (
            <SessionBadge key={session.id} session={session} onDisplay={() => onDisplaySession(session.id)} />
          ))}
        </span>
      )}
    </div>
  )
}

/** Another Session working on a Ticket; clicking it displays that Session, unless it runs elsewhere. */
function SessionBadge({ session, onDisplay }: { session: SessionSummary; onDisplay(): void }): ReactNode {
  const { t } = useTranslation()
  const title = session.title ?? t('explorer.untitled')
  const external = session.state === 'external'
  return (
    <button
      type="button"
      className="cf-ticket__session nopan"
      title={external ? `${title}\n${t('explorer.openElsewhereTooltip')}` : t('map.switchToSession', { title })}
      disabled={external}
      onClick={onDisplay}
    >
      <SquareTerminal className="cf-icon cf-icon--sm" aria-hidden="true" />
      <span>{title}</span>
    </button>
  )
}

const NODE_TYPES = { ticket: TicketCard }

/** The edges, drawn in the graph's own coordinates under the pan and zoom. */
function Edges({ layout, names }: { layout: MapLayout; names: Map<string, string> }): ReactNode {
  const { t } = useTranslation()
  return (
    <ViewportPortal>
      <svg className="map-edges" width={layout.width} height={layout.height}>
        {layout.edges.map((edge) => (
          <g
            key={`${edge.from}-${edge.to}`}
            role="img"
            aria-label={t('map.edge', { from: names.get(edge.from), to: names.get(edge.to) })}
          >
            <path className={edge.spent ? 'cf-edge cf-edge--spent' : 'cf-edge'} d={edge.line} />
            <path className={edge.spent ? 'cf-edge-head cf-edge-head--spent' : 'cf-edge-head'} d={edge.head} />
          </g>
        ))}
      </svg>
    </ViewportPortal>
  )
}

/**
 * Places a new layout at full size from the top: centred when it fits the
 * panel, from the left when a rank holds more Tickets than the panel shows.
 * Text never shrinks on its own; zoom and fit are the user's.
 */
function Placement({ layout }: { layout: MapLayout }): null {
  const flow = useReactFlow()
  const width = useStore((state) => state.width)
  useEffect(() => {
    if (width === 0) return
    void flow.setViewport({ x: Math.max(PADDING, (width - layout.width) / 2), y: PADDING, zoom: 1 })
  }, [flow, layout, width])
  return null
}

function ZoomControls(): ReactNode {
  const { t } = useTranslation()
  const flow = useReactFlow()
  return (
    <div className="map-zoom" role="group" aria-label={t('map.zoom')}>
      <IconButton icon={Minus} label={t('map.zoomOut')} onClick={() => void flow.zoomOut({ duration: ZOOM_DURATION })} />
      <IconButton icon={Plus} label={t('map.zoomIn')} onClick={() => void flow.zoomIn({ duration: ZOOM_DURATION })} />
      <IconButton
        icon={Maximize}
        label={t('map.fit')}
        onClick={() => void flow.fitView({ padding: `${PADDING}px`, maxZoom: 1, duration: ZOOM_DURATION })}
      />
    </div>
  )
}

function Counts({ tickets }: { tickets: Ticket[] }): ReactNode {
  const { t } = useTranslation()
  return (
    <p className="map-counts" role="status" aria-label={t('map.counts')}>
      {COUNTED_STATES.map((state, index) => (
        <span key={state}>
          {index > 0 && ' · '}
          {t(`map.count.${state}`, { count: tickets.filter((ticket) => ticket.state === state).length })}
        </span>
      ))}
    </p>
  )
}

interface MapGraphProps {
  map: WayfinderMap
  /** The opened Parent Ticket, whose Sub-tickets the graph shows; null for the Map's own Tickets. */
  level: string | null
  /** Draws the closed Tickets and their spent edges too. */
  showDecided: boolean
  /** The Sessions working on each Ticket, by Ticket id. */
  ticketSessions: Map<string, SessionSummary[]>
  displayedSessionId: string | null
  onDisplaySession(id: string): void
  onOpen(id: string): void
}

/** The names of a Ticket's blockers that are open Tickets of the Map. */
export function openBlockerNames(map: WayfinderMap, ticket: Ticket): string[] {
  return ticket.blockedBy.flatMap((id) => map.tickets.find((each) => each.id === id && each.open)?.name ?? [])
}

/** Every Ticket beneath a level of the Map, at any depth. */
function ticketsBeneath(map: WayfinderMap, level: string | null): Ticket[] {
  return map.tickets
    .filter((ticket) => ticket.parent === level)
    .flatMap((ticket) => [ticket, ...ticketsBeneath(map, ticket.id)])
}

/** The open work of one level of a Map, top to bottom, with pan, zoom and fit. */
export function MapGraph({
  map,
  level,
  showDecided,
  ticketSessions,
  displayedSessionId,
  onDisplaySession,
  onOpen
}: MapGraphProps): ReactNode {
  const { t } = useTranslation()

  // The layout changes with the Map and level only, so displaying another Session never moves the graph.
  const { layout, names } = useMemo(() => {
    const names = new Map(map.tickets.map((ticket) => [ticket.id, ticket.name]))
    const tickets = map.tickets.filter((ticket) => ticket.parent === level && (showDecided || ticket.open))
    const shown = new Set(tickets.map((ticket) => ticket.id))
    const edges = [
      ...map.liveEdges.map((edge) => ({ ...edge, spent: false })),
      ...(showDecided ? map.spentEdges.map((edge) => ({ ...edge, spent: true })) : [])
    ].filter((edge) => shown.has(edge.from) && shown.has(edge.to))
    return { layout: layoutMap(tickets, edges), names }
  }, [map, level, showDecided])
  const counted = useMemo(() => ticketsBeneath(map, level), [map, level])

  const nodes = useMemo(() => {
    return layout.tickets.map(({ ticket, x, y }): TicketCardNode => {
      const sessions = ticketSessions.get(ticket.id) ?? []
      const current = sessions.some((session) => session.id === displayedSessionId)
      return {
        id: ticket.id,
        type: 'ticket',
        position: { x, y },
        width: TICKET_WIDTH,
        height: layout.ticketHeight,
        ariaRole: 'group',
        ariaLabel: ticket.name,
        domAttributes: { 'aria-current': current || undefined },
        data: {
          ticket,
          blockers: openBlockerNames(map, ticket),
          current,
          sessions: sessions.filter((session) => session.id !== displayedSessionId),
          onDisplaySession,
          onOpen
        }
      }
    })
  }, [map, layout, ticketSessions, displayedSessionId, onDisplaySession, onOpen])

  return (
    <section className="map-graph" aria-label={t('map.graph')}>
      {nodes.length === 0 ? (
        <p className="empty">{t('map.allDecided')}</p>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={[]}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          minZoom={0.25}
          maxZoom={2}
          attributionPosition="top-right"
        >
          <Edges layout={layout} names={names} />
          <Placement layout={layout} />
          <ZoomControls />
        </ReactFlow>
      )}
      <Counts tickets={counted} />
    </section>
  )
}
