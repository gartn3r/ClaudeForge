import type { BackendApi, WayfinderLink } from '../../shared/api'

/**
 * A reference as typed after `/wayfinder`, reduced to what names a Map or Ticket:
 * `#12` and `…/issues/12` name 12, `.scratch/meal-planner/map.md` names meal-planner,
 * `issues/02-week-view.md` names 02-week-view.
 */
function referenceOf(typed: string): string {
  const segments = typed
    .replace(/^["'#]+|["']+$/g, '')
    .split(/[\\/]+/)
    .filter(Boolean)
  const last = segments.at(-1) ?? ''
  const name = /^map\.md$/i.test(last) ? (segments.at(-2) ?? '') : last
  return name.replace(/\.md$/i, '').toLowerCase()
}

/** Whether a reference names this Ticket: `2`, `02` and `02-week-view` all name Ticket `02`. */
function namesTicket(reference: string, id: string): boolean {
  if (reference === id.toLowerCase()) return true
  const number = /^\d+/.exec(reference)?.[0]
  return number !== undefined && /^\d+$/.test(id) && Number(number) === Number(id)
}

/**
 * Resolves the arguments of a `/wayfinder` invocation (`<Map> [<Ticket>]`) against a Project's
 * Maps; null when they name none of them. A Ticket the Map does not hold leaves a Map-only link.
 */
export async function resolveWayfinderLink(
  maps: BackendApi['map'],
  project: string,
  args: string
): Promise<WayfinderLink | null> {
  const [mapRef, ticketRef] = args.split(/\s+/).filter(Boolean).map(referenceOf)
  if (!mapRef) return null
  const summary = (await maps.list(project)).maps.find((map) => map.id.toLowerCase() === mapRef)
  if (!summary) return null
  const link: WayfinderLink = { mapId: summary.id, mapName: summary.name, ticket: null }
  if (!ticketRef) return link
  const ticket = (await maps.load(project, summary.id)).tickets.find((t) => namesTicket(ticketRef, t.id))
  return ticket ? { ...link, ticket: { id: ticket.id, name: ticket.name } } : link
}
