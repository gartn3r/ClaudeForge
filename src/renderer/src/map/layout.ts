// Lays a Map's graph out top to bottom with dagre and routes its edges
// through the gutters between columns, as the design system's Map rules ask.

import { Graph, layout } from '@dagrejs/dagre'
import type { Ticket, TicketEdge } from '../../../shared/api'

/** A compact Ticket node: 120px wide, three per rank in the 400px panel. */
export const NODE_WIDTH = 120
/** Every node takes the height of a three-line name, so ranks line up. */
export const NODE_HEIGHT = 84
/** `space-6` between ranks, `space-2` between the Tickets of a rank. */
const RANK_GAP = 24
const NODE_GAP = 8
const CORNER = 6
/** Room between the arrowhead's tip and the line's end. */
const HEAD = 7
/** Spacing of the entry points of several edges into one Ticket. */
const ENTRY_SPACING = 12

const ROOT = '\u0000root'

export interface PlacedTicket {
  ticket: Ticket
  /** Top-left corner. */
  x: number
  y: number
}

export interface RoutedEdge extends TicketEdge {
  spent: boolean
  /** SVG path of the line, ending at the arrowhead's base. */
  line: string
  /** SVG path of the arrowhead. */
  head: string
}

export interface MapLayout {
  tickets: PlacedTicket[]
  edges: RoutedEdge[]
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

/** An SVG path through orthogonal points, with rounded corners. */
function roundedPath(points: Point[]): string {
  const [first, ...rest] = points
  if (!first) return ''
  let d = `M${first.x} ${first.y}`
  for (let i = 0; i < rest.length; i++) {
    const corner = rest[i]!
    const before = points[i]!
    const after = rest[i + 1]
    if (!after) {
      d += ` L${corner.x} ${corner.y}`
      continue
    }
    const radius = Math.min(
      CORNER,
      Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
      Math.hypot(after.x - corner.x, after.y - corner.y) / 2
    )
    const towards = (from: Point, to: Point): Point => {
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
      return { x: from.x + ((to.x - from.x) / length) * radius, y: from.y + ((to.y - from.y) / length) * radius }
    }
    const start = towards(corner, before)
    const end = towards(corner, after)
    d += ` L${start.x} ${start.y} Q${corner.x} ${corner.y} ${end.x} ${end.y}`
  }
  return d
}

/** Removes repeated points and the middle of straight runs. */
function simplify(points: Point[]): Point[] {
  const kept: Point[] = []
  for (const point of points) {
    const last = kept.at(-1)
    if (last && last.x === point.x && last.y === point.y) continue
    const beforeLast = kept.at(-2)
    if (
      last &&
      beforeLast &&
      ((beforeLast.x === last.x && last.x === point.x) || (beforeLast.y === last.y && last.y === point.y))
    ) {
      kept[kept.length - 1] = point
      continue
    }
    kept.push(point)
  }
  return kept
}

/**
 * Lays the given Tickets out in ranks from top to bottom. The first rank holds
 * every Ticket with no blocker among the given edges; an edge that skips ranks
 * runs down the gutter dagre leaves for it between two columns.
 */
export function layoutMap(tickets: Ticket[], edges: (TicketEdge & { spent: boolean })[]): MapLayout {
  if (tickets.length === 0) return { tickets: [], edges: [], width: 0, height: 0 }
  const graph = new Graph()
  graph.setGraph({ rankdir: 'TB', nodesep: NODE_GAP, edgesep: NODE_GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 })
  graph.setDefaultEdgeLabel(() => ({}))

  // Nodes and edges go in Map order, which keeps the layout stable across changes.
  for (const { id } of tickets) graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const { from, to } of edges) graph.setEdge(from, to, { weight: 1, minlen: 1 })

  // dagre may push a Ticket with no blocker down to shorten its edges; a heavy
  // edge from a hidden root holds every such Ticket in the first rank.
  const blocked = new Set(edges.map((edge) => edge.to))
  graph.setNode(ROOT, { width: 0, height: 0 })
  for (const { id } of tickets) if (!blocked.has(id)) graph.setEdge(ROOT, id, { weight: 1000, minlen: 1 })

  layout(graph)

  const top = Math.min(...tickets.map(({ id }) => graph.node(id).y)) - NODE_HEIGHT / 2
  const left = Math.min(...tickets.map(({ id }) => graph.node(id).x)) - NODE_WIDTH / 2
  const centre = (id: string): Point => {
    const node = graph.node(id)
    return { x: node.x - left, y: node.y - top }
  }

  const placed = tickets.map((ticket) => {
    const { x, y } = centre(ticket.id)
    return { ticket, x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 }
  })
  // Rank tops, from the placed nodes: every node has the same height.
  const rankTops = [...new Set(placed.map((ticket) => ticket.y))].sort((a, b) => a - b)
  const rankOf = (y: number): number => rankTops.indexOf(y - NODE_HEIGHT / 2)

  // Several edges into one Ticket enter side by side, ordered by where they come from.
  const entries = new Map<string, string[]>()
  for (const edge of [...edges].sort((a, b) => centre(a.from).x - centre(b.from).x)) {
    entries.set(edge.to, [...(entries.get(edge.to) ?? []), edge.from])
  }

  const routed = edges.map((edge): RoutedEdge => {
    const source = centre(edge.from)
    const target = centre(edge.to)
    const sourceRank = rankOf(source.y)
    const targetRank = rankOf(target.y)
    const siblings = entries.get(edge.to)!
    const entryX = target.x + (siblings.indexOf(edge.from) - (siblings.length - 1) / 2) * ENTRY_SPACING

    // The column the edge holds in each rank it crosses, from dagre's dummy points.
    const columns = [source.x]
    const waypoints: Point[] = graph.edge(edge.from, edge.to)?.points ?? []
    for (let rank = sourceRank + 1; rank < targetRank; rank++) {
      const middle = rankTops[rank]! + NODE_HEIGHT / 2 + top
      const nearest = waypoints.reduce<Point | undefined>(
        (best, point) => (!best || Math.abs(point.y - middle) < Math.abs(best.y - middle) ? point : best),
        undefined
      )
      columns.push(nearest ? nearest.x - left : source.x)
    }
    columns.push(entryX)

    // Down from the source, across in the gap above each next rank, down into the target.
    const points: Point[] = [{ x: source.x, y: source.y + NODE_HEIGHT / 2 }]
    for (let step = 1; step < columns.length; step++) {
      const gap = rankTops[sourceRank + step - 1]! + NODE_HEIGHT + RANK_GAP / 2
      points.push({ x: columns[step - 1]!, y: gap }, { x: columns[step]!, y: gap })
    }
    const tip = target.y - NODE_HEIGHT / 2
    points.push({ x: entryX, y: tip - HEAD })

    return {
      ...edge,
      line: roundedPath(simplify(points)),
      head: `M${entryX - 4} ${tip - HEAD} L${entryX} ${tip} L${entryX + 4} ${tip - HEAD}z`
    }
  })

  return {
    tickets: placed,
    edges: routed,
    width: Math.max(...placed.map((ticket) => ticket.x + NODE_WIDTH)),
    height: Math.max(...placed.map((ticket) => ticket.y + NODE_HEIGHT))
  }
}
