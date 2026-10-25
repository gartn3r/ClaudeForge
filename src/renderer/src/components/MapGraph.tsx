import '@xyflow/react/dist/base.css'
import {
  ReactFlow,
  ViewportPortal,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps
} from '@xyflow/react'
import { Check, ChevronRight, Lock, Maximize, MessagesSquare, Minus, Plus, Search, Shapes, SquareCheck } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Ticket, TicketType, WayfinderMap } from '../../../shared/api'
import { NODE_HEIGHT, NODE_WIDTH, layoutMap, type MapLayout } from '../map/layout'
import { IconButton } from './IconButton'

const TYPE_ICONS: Record<TicketType, typeof Search> = {
  research: Search,
  prototype: Shapes,
  grilling: MessagesSquare,
  task: SquareCheck
}

/** Space kept around the graph when it is placed in the panel. */
const PADDING = 12
const ZOOM_DURATION = 120

type TicketNodeData = { ticket: Ticket; blockers: string[] }
type TicketNodeType = Node<TicketNodeData, 'ticket'>

function TicketState({ ticket }: { ticket: Ticket }): ReactNode {
  const { t } = useTranslation()
  const label =
    ticket.state === 'blocked' && ticket.openBlockers > 1
      ? t('map.state.blockedBy', { count: ticket.openBlockers })
      : t(`map.state.${ticket.state}`)
  return (
    <span className="cf-ticket__state cf-status" role="img" aria-label={label}>
      {ticket.state === 'frontier' && <ChevronRight className="cf-icon cf-icon--sm" aria-hidden="true" />}
      {ticket.state === 'claimed' && <span className="cf-dot" style={{ background: 'var(--route)' }} />}
      {ticket.state === 'blocked' && <Lock className="cf-icon cf-icon--sm" aria-hidden="true" />}
      {ticket.state === 'closed' && <Check className="cf-icon cf-icon--sm" aria-hidden="true" />}
      {ticket.state === 'blocked' && ticket.openBlockers > 1 && <span aria-hidden="true">{ticket.openBlockers}</span>}
    </span>
  )
}

/** A compact TicketNode: type, state glyph and name; the full name and any block in its tooltip. */
function TicketNode({ data: { ticket, blockers } }: NodeProps<TicketNodeType>): ReactNode {
  const { t } = useTranslation()
  const TypeIcon = ticket.type ? TYPE_ICONS[ticket.type] : null
  const tooltip =
    ticket.state === 'blocked'
      ? t('map.tooltip.blocked', { name: ticket.name, blockers: blockers.join(', ') })
      : t(`map.tooltip.${ticket.state}`, { name: ticket.name })
  return (
    <div className={`cf-ticket cf-ticket--compact cf-ticket--${ticket.state} map-node`} title={tooltip}>
      <span className="cf-ticket__head">
        {ticket.type && TypeIcon ? (
          <span className="cf-ticket__type">
            <TypeIcon className="cf-icon cf-icon--sm" aria-hidden="true" />
            {t(`map.type.${ticket.type}`)}
          </span>
        ) : (
          <span />
        )}
        <TicketState ticket={ticket} />
      </span>
      <span className="cf-ticket__name">{ticket.name}</span>
    </div>
  )
}

const NODE_TYPES = { ticket: TicketNode }

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

/** Places a new layout at full size, centred and from the top, or fits it when it is wider than the panel. */
function Placement({ layout }: { layout: MapLayout }): null {
  const flow = useReactFlow()
  const width = useStore((state) => state.width)
  useEffect(() => {
    if (width === 0) return
    if (layout.width + 2 * PADDING <= width) {
      void flow.setViewport({ x: (width - layout.width) / 2, y: PADDING, zoom: 1 })
    } else {
      void flow.fitView({ padding: PADDING / width, maxZoom: 1 })
    }
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
        onClick={() => void flow.fitView({ padding: 0.08, maxZoom: 1, duration: ZOOM_DURATION })}
      />
    </div>
  )
}

function Counts({ tickets }: { tickets: Ticket[] }): ReactNode {
  const { t } = useTranslation()
  const count = (state: Ticket['state']): number => tickets.filter((ticket) => ticket.state === state).length
  const items = [
    { state: 'frontier', text: t('map.count.frontier', { count: count('frontier') }) },
    { state: 'claimed', text: t('map.count.claimed', { count: count('claimed') }) },
    { state: 'blocked', text: t('map.count.blocked', { count: count('blocked') }) },
    { state: 'closed', text: t('map.count.closed', { count: count('closed') }) }
  ]
  return (
    <p className="map-counts" role="status" aria-label={t('map.counts')}>
      {items.map(({ state, text }, index) => (
        <span key={state} data-state={state}>
          {index > 0 && ' · '}
          {text}
        </span>
      ))}
    </p>
  )
}

interface MapGraphProps {
  map: WayfinderMap
  /** Draws the closed Tickets and their spent edges too. */
  showDecided: boolean
}

/** The open work of a Map, top to bottom, with pan, zoom and fit. */
export function MapGraph({ map, showDecided }: MapGraphProps): ReactNode {
  const { t } = useTranslation()

  const { layout, nodes, names } = useMemo(() => {
    const names = new Map(map.tickets.map((ticket) => [ticket.id, ticket.name]))
    const tickets = map.tickets.filter((ticket) => showDecided || ticket.open)
    const edges = [
      ...map.liveEdges.map((edge) => ({ ...edge, spent: false })),
      ...(showDecided ? map.spentEdges.map((edge) => ({ ...edge, spent: true })) : [])
    ]
    const layout = layoutMap(tickets, edges)
    const nodes: TicketNodeType[] = layout.tickets.map(({ ticket, x, y }) => ({
      id: ticket.id,
      type: 'ticket',
      position: { x, y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      ariaRole: 'group',
      ariaLabel: ticket.name,
      data: {
        ticket,
        blockers: ticket.blockedBy
          .filter((id) => map.tickets.find((other) => other.id === id)?.open)
          .map((id) => names.get(id)!)
      }
    }))
    return { layout, nodes, names }
  }, [map, showDecided])

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
