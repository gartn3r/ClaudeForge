import type { Ticket, TicketEdge, TicketState, WayfinderMap } from '../../shared/api'
import type { MapRecord, TicketRecord } from './local-markdown'

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
  const { sections, tickets: records, ...summary } = record
  const open = new Set(records.filter((ticket) => ticket.open).map((ticket) => ticket.id))

  // Edges between Tickets of the Map, listed by blocked Ticket then blocker, both in Map order.
  const order = new Map(records.map((ticket, index) => [ticket.id, index]))
  const edges = records.flatMap((ticket) =>
    ticket.blockedBy
      .filter((id) => order.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!)
      .map((from) => ({ from, to: ticket.id }))
  )

  const tickets = records.map((ticket): Ticket => {
    // A reference to a Ticket the Map does not have blocks nothing.
    const openBlockers = ticket.blockedBy.filter((id) => open.has(id)).length
    const state = stateOf(ticket, openBlockers)
    return {
      ...ticket,
      state,
      // A local markdown claim names no one: the files, and the claim, are the user's own.
      workable: state === 'frontier' || state === 'claimed',
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
