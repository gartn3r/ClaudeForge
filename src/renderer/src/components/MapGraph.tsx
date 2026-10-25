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
import { useTranslation } from 'react-i18next'
import type { SessionSummary, Ticket, TicketState, TicketType, WayfinderMap } from '../../../shared/api'
import { TICKET_HEIGHT, TICKET_WIDTH, layoutMap, type MapLayout } from '../map/layout'
import { IconButton } from './IconButton'

const TYPE_ICONS: Record<TicketType, typeof Search> = {
  research: Search,
  prototype: Shapes,
  grilling: MessagesSquare,
  task: SquareCheck
}

const STATE_GLYPHS: Record<TicketState, ReactNode> = {
  frontier: <ChevronRight className="cf-icon cf-icon--sm" aria-hidden="true" />,
  claimed: <span className="cf-dot" style={{ background: 'var(--route)' }} />,
  blocked: <Lock className="cf-icon cf-icon--sm" aria-hidden="true" />,
  closed: <Check className="cf-icon cf-icon--sm" aria-hidden="true" />
}

/** The order of the counts line. */
const COUNTED_STATES: readonly TicketState[] = ['frontier', 'claimed', 'blocked', 'closed']

/** Space kept around the graph when it is placed in or fitted to the panel. */
const PADDING = 12
const ZOOM_DURATION = 120

type TicketCardData = {
  ticket: Ticket
  blockers: string[]
  /** The displayed Session works on this Ticket. */
  current: boolean
  /** The other Sessions working on it, each a badge that displays it. */
  sessions: SessionSummary[]
  onDisplaySession(id: string): void
}
type TicketCardNode = Node<TicketCardData, 'ticket'>

/** The state glyph, with the open-blocker count when several open Tickets block it. */
function StateGlyph({ ticket }: { ticket: Ticket }): ReactNode {
  const { t } = useTranslation()
  const several = ticket.state === 'blocked' && ticket.openBlockers > 1
  const label = several ? t('map.state.blockedBy', { count: ticket.openBlockers }) : t(`map.state.${ticket.state}`)
  return (
    <span className="cf-ticket__state cf-status" role="img" aria-label={label}>
      {STATE_GLYPHS[ticket.state]}
      {several && <span aria-hidden="true">{ticket.openBlockers}</span>}
    </span>
  )
}

/** A compact Ticket: type, state glyph and name; the full name and any block in its tooltip. */
function TicketCard({ data: { ticket, blockers, current, sessions, onDisplaySession } }: NodeProps<TicketCardNode>): ReactNode {
  const { t } = useTranslation()
  const TypeIcon = ticket.type ? TYPE_ICONS[ticket.type] : null
  const tooltip =
    ticket.state === 'blocked'
      ? t('map.tooltip.blocked', { name: ticket.name, blockers: blockers.join(', ') })
      : t(`map.tooltip.${ticket.state}`, { name: ticket.name })
  const classes = ['cf-ticket', 'cf-ticket--compact', `cf-ticket--${ticket.state}`, 'map-ticket']
  if (current) classes.push('cf-ticket--current')
  return (
    <div className={classes.join(' ')} title={tooltip}>
      <span className="cf-ticket__head">
        {ticket.type && TypeIcon ? (
          <span className="cf-ticket__type">
            <TypeIcon className="cf-icon cf-icon--sm" aria-hidden="true" />
            {t(`map.type.${ticket.type}`)}
          </span>
        ) : (
          <span />
        )}
        <StateGlyph ticket={ticket} />
      </span>
      <span className="cf-ticket__name">{ticket.name}</span>
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
  /** Draws the closed Tickets and their spent edges too. */
  showDecided: boolean
  /** The Sessions working on each Ticket, by Ticket id. */
  ticketSessions: Map<string, SessionSummary[]>
  displayedSessionId: string | null
  onDisplaySession(id: string): void
}

/** The open work of a Map, top to bottom, with pan, zoom and fit. */
export function MapGraph({
  map,
  showDecided,
  ticketSessions,
  displayedSessionId,
  onDisplaySession
}: MapGraphProps): ReactNode {
  const { t } = useTranslation()

  // The layout changes with the Map only, so displaying another Session never moves the graph.
  const { layout, names } = useMemo(() => {
    const names = new Map(map.tickets.map((ticket) => [ticket.id, ticket.name]))
    const tickets = map.tickets.filter((ticket) => showDecided || ticket.open)
    const edges = [
      ...map.liveEdges.map((edge) => ({ ...edge, spent: false })),
      ...(showDecided ? map.spentEdges.map((edge) => ({ ...edge, spent: true })) : [])
    ]
    return { layout: layoutMap(tickets, edges), names }
  }, [map, showDecided])

  const nodes = useMemo(() => {
    const open = new Set(map.tickets.filter((ticket) => ticket.open).map((ticket) => ticket.id))
    return layout.tickets.map(({ ticket, x, y }): TicketCardNode => {
      const sessions = ticketSessions.get(ticket.id) ?? []
      const current = sessions.some((session) => session.id === displayedSessionId)
      return {
        id: ticket.id,
        type: 'ticket',
        position: { x, y },
        width: TICKET_WIDTH,
        height: TICKET_HEIGHT,
        ariaRole: 'group',
        ariaLabel: ticket.name,
        domAttributes: { 'aria-current': current || undefined },
        data: {
          ticket,
          blockers: ticket.blockedBy.filter((id) => open.has(id)).map((id) => names.get(id)!),
          current,
          sessions: sessions.filter((session) => session.id !== displayedSessionId),
          onDisplaySession
        }
      }
    })
  }, [map, layout, names, ticketSessions, displayedSessionId, onDisplaySession])

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
      <Counts tickets={map.tickets} />
    </section>
  )
}
