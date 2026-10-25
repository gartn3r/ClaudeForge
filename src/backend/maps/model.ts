import type { MapSummary, Ticket, TicketEdge, TicketRollup, TicketState, TicketType, WayfinderMap } from '../../shared/api'

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
  /** The Ticket it is a Sub-ticket of, as its Tracker names it; null for a Ticket of the Map itself. */
  parent: string | null
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

function stateOf(
  ticket: Pick<TicketRecord, 'open' | 'claimed'>,
  blocked: boolean,
  openSubTickets: boolean
): TicketState {
  if (!ticket.open) return 'closed'
  if (blocked) return 'blocked'
  if (openSubTickets) return 'parent'
  if (ticket.claimed) return 'claimed'
  return 'frontier'
}

/**
 * Each Ticket's parent, when it names another Ticket of the Map. A Ticket whose
 * parents lead back round to itself stays at the Map's level, so the rest is a tree.
 */
function parentsOf(records: TicketRecord[]): Map<string, string | null> {
  const stated = new Map(records.map((ticket) => [ticket.id, ticket.parent]))
  const known = (id: string | null | undefined): id is string => id != null && stated.has(id)
  const inCircle = (id: string): boolean => {
    const seen = new Set<string>()
    for (let at = stated.get(id); known(at); at = stated.get(at)) {
      if (at === id) return true
      if (seen.has(at)) return false
      seen.add(at)
    }
    return false
  }
  return new Map(records.map(({ id, parent }) => [id, known(parent) && !inCircle(id) ? parent : null]))
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
  const parents = parentsOf(records)
  const children = new Map<string, string[]>()
  for (const { id } of records) {
    const parent = parents.get(id)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), id])
  }

  const hasOpenSubTickets = (id: string): boolean => (children.get(id) ?? []).some((child) => open.has(child))

  // Edges between Tickets of one level, listed by blocked Ticket then blocker, both in Map order.
  const order = new Map(records.map((ticket, index) => [ticket.id, index]))
  const edges = records.flatMap((ticket) =>
    ticket.blockedBy
      .filter((id) => order.has(id) && parents.get(id) === parents.get(ticket.id))
      .sort((a, b) => order.get(a)! - order.get(b)!)
      .map((from) => ({ from, to: ticket.id }))
  )

  // A reference to a Ticket the Map does not have blocks nothing, unless its Tracker says it is open.
  const openBlockers = new Map(records.map((ticket) => [ticket.id, ticket.blockedBy.filter(openBlocker).length]))
  // An open blocker on any ancestor blocks every Ticket beneath it (ADR 0004).
  const parentWaits = (id: string): boolean => {
    const parent = parents.get(id)
    return parent != null && (openBlockers.get(parent)! > 0 || parentWaits(parent))
  }
  const states = new Map(
    records.map((ticket) => {
      const blocked = openBlockers.get(ticket.id)! > 0 || parentWaits(ticket.id)
      return [ticket.id, stateOf(ticket, blocked, hasOpenSubTickets(ticket.id))]
    })
  )
  const descendantsOf = (id: string): string[] =>
    (children.get(id) ?? []).flatMap((child) => [child, ...descendantsOf(child)])
  // Only a Parent Ticket, one with open Sub-tickets, carries a roll-up.
  const rollupOf = (id: string): TicketRollup | null => {
    if (!hasOpenSubTickets(id)) return null
    const beneath = descendantsOf(id).map((descendant) => states.get(descendant))
    const count = (state: TicketState): number => beneath.filter((each) => each === state).length
    return {
      subTickets: children.get(id)!.length,
      total: beneath.length,
      closed: count('closed'),
      claimed: count('claimed'),
      frontier: count('frontier')
    }
  }

  const tickets = records.map(({ claimedByUser, ...ticket }): Ticket => {
    const state = states.get(ticket.id)!
    return {
      ...ticket,
      parent: parents.get(ticket.id)!,
      state,
      workable: state === 'frontier' || (state === 'claimed' && claimedByUser),
      openBlockers: openBlockers.get(ticket.id)!,
      parentWaits: parentWaits(ticket.id),
      rollup: rollupOf(ticket.id)
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
