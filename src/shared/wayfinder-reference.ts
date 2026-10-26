// Wayfinder references: how a `/wayfinder` invocation names a Map or Ticket. The Map panel writes
// them in one canonical form per Tracker, and the backend parses them back, with the forms people
// type by hand, to link a Session to the Map and Ticket it works on.

import type { MapSummary, Ticket, Tracker } from './api'

/** A Map or Ticket a `/wayfinder` invocation names, as typed. */
export type WayfinderReference =
  /** A GitHub issue: `#12`, `owner/repo#12` or its URL; `repository` is null for `#12`, an issue of the Project's own repository. */
  | { kind: 'issue'; repository: string | null; number: number }
  /**
   * A local markdown path: `.scratch/meal-planner/map.md` names the effort, and
   * `.scratch/meal-planner/issues/03-leftovers.md` its Ticket `03`; `effort` is null when the path does not say.
   */
  | { kind: 'path'; effort: string | null; ticket: string | null }
  /** A bare word: a Map's id (`meal-planner`, `70`) or a Ticket's (`02`, `2`, `02-week-view`). */
  | { kind: 'name'; name: string }

const ISSUE_URL = /^https?:\/\/[^/\s]+\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i
const ISSUE = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/
/** A local markdown Ticket's file, `NN-<slug>.md`, as the local markdown Tracker files it. */
const TICKET_FILE = /^(\d+)-.+\.md$/i

/** A reference written into a command: quoted when it holds a blank, which would end it. */
const quoted = (reference: string): string => (/\s/.test(reference) ? `"${reference}"` : reference)

/** How a Map or Ticket id is written for its Tracker: an issue of the Project's GitHub repository as `#12`. */
const written = (tracker: Tracker, id: string): string =>
  quoted(tracker.kind === 'github' && /^\d+$/.test(id) ? `#${id}` : id)

/** The `/wayfinder` command that starts work on a Ticket of a Map; null unless it is workable. */
export function commandForTicket(tracker: Tracker, mapId: string, ticket: Ticket): string | null {
  return ticket.workable ? `/wayfinder ${written(tracker, mapId)} ${written(tracker, ticket.id)}` : null
}

/**
 * The `/wayfinder` command that works a Parent Ticket as a Map of its own: its GitHub issue, or its
 * markdown file, from the Project's folder when it lies inside. Null unless it is a Parent Ticket
 * that is not blocked (ADR 0004).
 */
export function commandForLevel(tracker: Tracker, project: string, ticket: Ticket): string | null {
  if (ticket.state !== 'parent') return null
  if (tracker.kind === 'github') return `/wayfinder ${written(tracker, ticket.id)}`
  const folder = project.replace(/[\\/]+$/, '')
  const inside =
    ticket.path.slice(0, folder.length).toLowerCase() === folder.toLowerCase() && /[\\/]/.test(ticket.path[folder.length] ?? '')
  return `/wayfinder ${quoted((inside ? ticket.path.slice(folder.length + 1) : ticket.path).replace(/\\/g, '/'))}`
}

/** The words of an invocation's arguments, a quoted one holding its blanks. */
function wordsOf(args: string): string[] {
  return [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? (match[3] ?? '').replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
}

function parseWord(word: string): WayfinderReference {
  const issue = ISSUE_URL.exec(word) ?? ISSUE.exec(word)
  if (issue) return { kind: 'issue', repository: issue[1] ?? null, number: Number(issue[2]) }
  if (!/[\\/]/.test(word) && !/\.md$/i.test(word)) return { kind: 'name', name: word }
  const segments = word.split(/[\\/]+/).filter(Boolean)
  const file = segments.at(-1) ?? ''
  if (/^map\.md$/i.test(file)) return { kind: 'path', effort: segments.at(-2) ?? null, ticket: null }
  const ticket = TICKET_FILE.exec(file)?.[1]
  if (ticket) {
    const inIssues = /^issues$/i.test(segments.at(-2) ?? '')
    return { kind: 'path', effort: inIssues ? (segments.at(-3) ?? null) : null, ticket }
  }
  // Any other path names nothing a Tracker holds, but its last word may name a Map, `.scratch/meal-planner`.
  return { kind: 'name', name: file.replace(/\.md$/i, '') }
}

/** The references of a `/wayfinder` invocation's arguments (`<Map> [<Ticket>]`), in order. */
export const parseWayfinderArgs = (args: string): WayfinderReference[] => wordsOf(args).map(parseWord)

/** Whether an issue's address is `<repository>/issues/<number>`, whatever the case of the repository. */
const isIssue = (path: string, repository: string, number: number): boolean =>
  path.toLowerCase().endsWith(`/${repository.toLowerCase()}/issues/${number}`)

/** Whether a reference names this Map, as a Map. */
export function namesMap(reference: WayfinderReference, map: Pick<MapSummary, 'id' | 'path'>): boolean {
  switch (reference.kind) {
    case 'issue':
      return reference.repository === null
        ? map.id === String(reference.number)
        : isIssue(map.path, reference.repository, reference.number)
    case 'path':
      return reference.ticket === null && reference.effort?.toLowerCase() === map.id.toLowerCase()
    case 'name':
      return reference.name.toLowerCase() === map.id.toLowerCase()
  }
}

/** Whether a reference names this Ticket: `2`, `02` and `02-week-view` all name Ticket `02`. */
export function namesTicket(reference: WayfinderReference, ticket: Pick<Ticket, 'id' | 'path'>): boolean {
  const sameNumber = (number: string | undefined): boolean =>
    number !== undefined && /^\d+$/.test(ticket.id) && Number(number) === Number(ticket.id)
  switch (reference.kind) {
    case 'issue':
      // `#4` names local markdown Ticket `04` too, as typed by hand.
      return reference.repository === null
        ? sameNumber(String(reference.number))
        : isIssue(ticket.path, reference.repository, reference.number)
    case 'path': {
      // A path into another effort names a Ticket of that effort's Map, whatever its number.
      const effort = ticket.path.split(/[\\/]+/).at(-3)
      const sameEffort = reference.effort === null || reference.effort.toLowerCase() === effort?.toLowerCase()
      return sameEffort && sameNumber(reference.ticket ?? undefined)
    }
    case 'name':
      return reference.name.toLowerCase() === ticket.id.toLowerCase() || sameNumber(/^\d+/.exec(reference.name)?.[0])
  }
}
