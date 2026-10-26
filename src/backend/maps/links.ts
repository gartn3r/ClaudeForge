import type { WayfinderLink } from '../../shared/api'
import { namesMap, namesTicket, parseWayfinderArgs } from '../../shared/wayfinder-reference'
import type { MapReader } from '.'

/**
 * Resolves the arguments of a `/wayfinder` invocation (`<Map> [<Ticket>]`) against a Project's
 * Maps; null when they name none of them. A lone reference is tried as a Map, then as a Ticket
 * worked as a Map of its own, which links the Map holding it. The link carries the most specific
 * Ticket named; one the Map does not hold leaves a Map-only link.
 */
export async function resolveWayfinderLink(
  maps: MapReader,
  project: string,
  args: string
): Promise<WayfinderLink | null> {
  const [first, second] = parseWayfinderArgs(args)
  if (!first) return null
  const summaries = (await maps.list(project)).maps
  const named = summaries.find((map) => namesMap(first, map))
  const holding = named ? null : await maps.mapHolding(project, first)
  const summary = named ?? summaries.find((map) => map.id === holding)
  if (!summary) return null
  const link: WayfinderLink = { mapId: summary.id, mapName: summary.name, ticket: null }
  const ticketRef = named ? second : (second ?? first)
  if (!ticketRef) return link
  const ticket = (await maps.load(project, summary.id)).tickets.find((t) => namesTicket(ticketRef, t))
  return ticket ? { ...link, ticket: { id: ticket.id, name: ticket.name } } : link
}
