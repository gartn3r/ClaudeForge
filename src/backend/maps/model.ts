import type { MapSummary, Ticket, TicketEdge, TicketState, TicketType, WayfinderMap } from '../../shared/api'

/** A Ticket as its Tracker states it, before anything is derived. */
export interface TicketRecord {
  id: string
  name: string
  type: TicketType | null
  open: boolean
  claimed: boolean
  /** Claimed by the user ClaudeForge runs for. */
  claimedByUser: boolean
  assignee: string | null
  blockedBy: string[]
  path: string
  question: string
  answer: string
}

/** A Map as its Tracker stores it. */
export interface MapRecord extends MapSummary {
  sections: Record<string, string>
  tickets: TicketRecord[]
  /** Ids of open issues outside the Map that some Ticket names as a blocker. */
  openOutside?: string[]
}

function stateOf(ticket: Pick<TicketRecord, 'open' | 'claimed'>, openBlockers: number): TicketState {
  if (!ticket.open) return 'closed'
  if (openBlockers > 0) return 'blocked'
  if (ticket.claimed) return 'claimed'
  return 'frontier'
}

/**
 * Drops every edge implied by a longer path (when A blocks B and B blocks C,
 * the edge from A to C). Malformed Maps with cycles terminate too.
 */
function transitiveReduction(edges: TicketEdge[]): TicketEdge[] {
  const blocks = new Map<string, string[]>()
  for (const { from, to } of edges) blocks.set(from, [...(blocks.get(from) ?? []), to])

  const reachable = (start: string, target: string): boolean => {
    const seen = new Set<string>()
    const stack = [start]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (id === target) return true
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...(blocks.get(id) ?? []))
    }
    return false
  }

  return edges.filter(({ from, to }) =>
    (blocks.get(from) ?? []).every((via) => via === to || !reachable(via, to))
  )
}

/** Turns a Map as its Tracker stores it into the model the panel draws. */
export function deriveMap(record: MapRecord): WayfinderMap {
  const { sections, tickets: records, openOutside = [], ...summary } = record
  const open = new Set(records.filter((ticket) => ticket.open).map((ticket) => ticket.id))
  const openBlocker = (id: string): boolean => open.has(id) || openOutside.includes(id)

  // Edges between Tickets of the Map, listed by blocked Ticket then blocker, both in Map order.
  const order = new Map(records.map((ticket, index) => [ticket.id, index]))
  const edges = records.flatMap((ticket) =>
    ticket.blockedBy
      .filter((id) => order.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!)
      .map((from) => ({ from, to: ticket.id }))
  )

  const tickets = records.map(({ claimedByUser, ...ticket }): Ticket => {
    // A reference to a Ticket the Map does not have blocks nothing, unless its Tracker says it is open.
    const openBlockers = ticket.blockedBy.filter(openBlocker).length
    const state = stateOf(ticket, openBlockers)
    return {
      ...ticket,
      state,
      workable: state === 'frontier' || (state === 'claimed' && claimedByUser),
      openBlockers
    }
  })

  return {
    ...summary,
    destination: sections.destination ?? '',
    notes: sections.notes ?? '',
    decisionsSoFar: sections['decisions so far'] ?? '',
    notYetSpecified: sections['not yet specified'] ?? '',
    outOfScope: sections['out of scope'] ?? '',
    tickets,
    decided: tickets.filter((ticket) => !ticket.open).map((ticket) => ticket.id),
    liveEdges: transitiveReduction(edges.filter(({ from, to }) => open.has(from) && open.has(to))),
    spentEdges: transitiveReduction(edges).filter(({ from, to }) => !open.has(from) || !open.has(to))
  }
}
