// Lays a Map's graph out top to bottom with dagre and routes its edges
// through the gutters between columns, as the design system's Map rules ask.

import { Graph, layout } from '@dagrejs/dagre'
import type { Ticket, TicketEdge } from '../../../shared/api'

/** A compact Ticket: 120px wide, three per rank in the 400px panel. */
export const TICKET_WIDTH = 120
/** Every Ticket takes the height of a three-line name, so ranks line up. */
export const TICKET_HEIGHT = 84
/** `space-6` between ranks, `space-2` between the Tickets of a rank. */
const RANK_GAP = 24
const TICKET_GAP = 8
const CORNER = 6
/** Length of an arrowhead, from its base to its tip. */
const HEAD_LENGTH = 7
/** Spacing of the entry points of several edges into one Ticket. */
const ENTRY_SPACING = 12
/** Horizontal runs that share a gap take separate lanes this far apart, at most. */
const LANE_SPACING = 5
/** The band of a gap where horizontal runs may go: clear of the rank above and of the arrowheads below. */
const LANE_TOP = 3
const LANE_BOTTOM = RANK_GAP - HEAD_LENGTH - 3

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

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item])
  return groups
}

/** One horizontal run of an edge, in the gap under a rank. */
interface Run {
  gap: number
  from: number
  to: number
  /** Runs of the same source may share a lane: they leave together. */
  source: string
}

/**
 * Gives each source its own lane in every gap where its runs would overlap
 * another source's, so a reader can follow each edge. Returns the y offset
 * into the gap of each run.
 */
function assignLanes(runs: Run[]): Map<Run, number> {
  const offsets = new Map<Run, number>()
  const gaps = groupBy(runs, (run) => run.gap)
  for (const gapRuns of gaps.values()) {
    const spans = [...groupBy(gapRuns, (run) => run.source).values()].map((group) => ({
      group,
      min: Math.min(...group.flatMap((run) => [run.from, run.to])),
      max: Math.max(...group.flatMap((run) => [run.from, run.to]))
    }))
    spans.sort((a, b) => a.min - b.min)
    const laneEnds: number[] = []
    const laneOf = new Map<(typeof spans)[number], number>()
    for (const span of spans) {
      let lane = laneEnds.findIndex((end) => end + TICKET_GAP <= span.min)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = span.max
      laneOf.set(span, lane)
    }
    const count = laneEnds.length
    const spacing = count > 1 ? Math.min(LANE_SPACING, (LANE_BOTTOM - LANE_TOP) / (count - 1)) : 0
    const middle = (LANE_TOP + LANE_BOTTOM) / 2
    for (const span of spans) {
      const offset = middle + (laneOf.get(span)! - (count - 1) / 2) * spacing
      for (const run of span.group) offsets.set(run, offset)
    }
  }
  return offsets
}

/**
 * Lays the given Tickets out in ranks from top to bottom. The first rank of
 * open work holds every open Ticket with no open blocker; decided Tickets, when
 * drawn, sit above it. An edge that skips ranks runs down the gutter dagre
 * leaves for it between two columns.
 */
export function layoutMap(tickets: Ticket[], edges: (TicketEdge & { spent: boolean })[]): MapLayout {
  if (tickets.length === 0) return { tickets: [], edges: [], width: 0, height: 0 }
  const graph = new Graph()
  graph.setGraph({ rankdir: 'TB', nodesep: TICKET_GAP, edgesep: TICKET_GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 })
  graph.setDefaultEdgeLabel(() => ({}))

  // Tickets and edges go in Map order, which keeps the layout stable across changes.
  for (const { id } of tickets) graph.setNode(id, { width: TICKET_WIDTH, height: TICKET_HEIGHT })
  for (const { from, to } of edges) graph.setEdge(from, to, { weight: 1, minlen: 1 })

  // dagre may push a Ticket with no blocker down to shorten its edges; heavy
  // edges from a hidden root hold the open Tickets with no open blocker in the
  // first rank of open work, and the decided Tickets with no blocker one above.
  const openlyBlocked = new Set(edges.filter((edge) => !edge.spent).map((edge) => edge.to))
  const blocked = new Set(edges.map((edge) => edge.to))
  graph.setNode(ROOT, { width: 0, height: 0 })
  for (const { id, open } of tickets) {
    if (open && !openlyBlocked.has(id)) graph.setEdge(ROOT, id, { weight: 1000, minlen: 2 })
    else if (!open && !blocked.has(id)) graph.setEdge(ROOT, id, { weight: 1000, minlen: 1 })
  }

  layout(graph)

  const top = Math.min(...tickets.map(({ id }) => graph.node(id).y)) - TICKET_HEIGHT / 2
  const left = Math.min(...tickets.map(({ id }) => graph.node(id).x)) - TICKET_WIDTH / 2
  const centre = (id: string): Point => {
    const { x, y } = graph.node(id)
    return { x: x - left, y: y - top }
  }

  const placed = tickets.map((ticket) => {
    const { x, y } = centre(ticket.id)
    return { ticket, x: x - TICKET_WIDTH / 2, y: y - TICKET_HEIGHT / 2 }
  })
  // Rank tops, from the placed Tickets: every Ticket has the same height.
  const rankTops = [...new Set(placed.map((ticket) => ticket.y))].sort((a, b) => a - b)
  const rankOf = (centreY: number): number => rankTops.indexOf(centreY - TICKET_HEIGHT / 2)

  // Several edges into one Ticket enter side by side, ordered by where they come from.
  const entries = new Map<string, string[]>()
  for (const edge of [...edges].sort((a, b) => centre(a.from).x - centre(b.from).x)) {
    entries.set(edge.to, [...(entries.get(edge.to) ?? []), edge.from])
  }

  // The column each edge holds in each rank from its source to its target.
  const routes = edges.map((edge) => {
    const source = centre(edge.from)
    const target = centre(edge.to)
    const sourceRank = rankOf(source.y)
    const siblings = entries.get(edge.to)!
    const entryX = target.x + (siblings.indexOf(edge.from) - (siblings.length - 1) / 2) * ENTRY_SPACING

    const columns = [source.x]
    const waypoints: Point[] = graph.edge(edge.from, edge.to)?.points ?? []
    for (let rank = sourceRank + 1; rank < rankOf(target.y); rank++) {
      // dagre's placeholder for the edge in this rank, nearest its middle.
      const middle = rankTops[rank]! + TICKET_HEIGHT / 2 + top
      const nearest = waypoints.reduce<Point | undefined>(
        (best, point) => (!best || Math.abs(point.y - middle) < Math.abs(best.y - middle) ? point : best),
        undefined
      )
      columns.push(nearest ? nearest.x - left : source.x)
    }
    columns.push(entryX)
    const runs: Run[] = columns.slice(1).map((to, step) => ({
      gap: sourceRank + step,
      from: columns[step]!,
      to,
      source: edge.from
    }))
    return { edge, source, target, entryX, runs }
  })

  const lanes = assignLanes(routes.flatMap((route) => route.runs.filter((run) => run.from !== run.to)))

  const routed = routes.map(({ edge, source, target, entryX, runs }): RoutedEdge => {
    // Down from the source, across in its lane of each gap, down into the target.
    const points: Point[] = [{ x: source.x, y: source.y + TICKET_HEIGHT / 2 }]
    for (const run of runs) {
      const y = rankTops[run.gap]! + TICKET_HEIGHT + (lanes.get(run) ?? RANK_GAP / 2)
      points.push({ x: run.from, y }, { x: run.to, y })
    }
    const tip = target.y - TICKET_HEIGHT / 2
    points.push({ x: entryX, y: tip - HEAD_LENGTH })
    return {
      ...edge,
      line: roundedPath(simplify(points)),
      head: `M${entryX - 4} ${tip - HEAD_LENGTH} L${entryX} ${tip} L${entryX + 4} ${tip - HEAD_LENGTH}z`
    }
  })

  return {
    tickets: placed,
    edges: routed,
    width: Math.max(...placed.map((ticket) => ticket.x + TICKET_WIDTH)),
    height: Math.max(...placed.map((ticket) => ticket.y + TICKET_HEIGHT))
  }
}
