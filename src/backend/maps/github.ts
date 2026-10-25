// The GitHub Tracker, as Wayfinder writes it (docs/agents/issue-tracker.md,
// "Wayfinding operations"): a Map is an issue labelled `wayfinder:map`, its
// Tickets are its sub-issues, blocking is GitHub's native issue dependencies,
// and `wayfinder:<type>` labels give the Ticket types. Where sub-issues or
// dependencies are not available, Wayfinder falls back to a task list in the
// Map body and a `Blocked by: #<n>` line in the Ticket body. Everything is read
// through the REST API with `gh api`, in the Project's folder so `gh` finds its
// repository.

import type { MapSummary, TicketType } from '../../shared/api'
import { GhError, type Gh } from './gh'
import { questionOf, sectionsOf } from './markdown'
import type { MapRecord, TicketRecord } from './model'

const MAP_LABEL = 'wayfinder:map'
const TICKET_TYPES: readonly TicketType[] = ['research', 'prototype', 'grilling', 'task']
const METADATA_LINE = /^\s*(Part of|Blocked by)\b/i

/** How many `gh` calls run at once while a Map loads. */
const CONCURRENT_CALLS = 4

/** The fields ClaudeForge reads of a GitHub REST issue. */
interface Issue {
  number: number
  title: string
  html_url: string
  /** `https://api.github.com/repos/<owner>/<repo>` */
  repository_url: string
  state: 'open' | 'closed'
  updated_at: string
  body: string | null
  labels: { name: string }[]
  assignees: { login: string }[]
  pull_request?: unknown
  sub_issues_summary?: { total: number; completed: number }
  issue_dependencies_summary?: { total_blocked_by: number }
}

/** An issue, as `#<n>` within the Map's repository or `<owner>/<repo>#<n>` beyond it. */
interface Reference {
  repository: string
  number: number
}

/** False once the Map is closed, or every one of its sub-issues is. */
function isOpen(map: Issue): boolean {
  const summary = map.sub_issues_summary
  return map.state === 'open' && !(summary && summary.total > 0 && summary.completed === summary.total)
}

const summaryOf = (map: Issue): MapSummary => ({
  id: String(map.number),
  name: map.title,
  path: map.html_url,
  updatedAt: Date.parse(map.updated_at),
  open: isOpen(map)
})

const repositoryOfIssue = (issue: Issue): string => issue.repository_url.replace(/^.*\/repos\//, '')

/** The issue references in a piece of markdown: `#12`, `owner/repo#12` or an issue URL. */
function referencesIn(text: string, repository: string): Reference[] {
  const pattern = /(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|(?<![\w/#])([\w.-]+\/[\w.-]+)?#)(\d+)\b/g
  return [...text.matchAll(pattern)].map((match) => ({
    repository: match[1] ?? match[2] ?? repository,
    number: Number(match[3])
  }))
}

/** The Tickets of a Map charted without sub-issues: the issues of the task list in its body, one per item. */
function taskListOf(map: Issue, repository: string): Reference[] {
  return (map.body ?? '').split(/\r?\n/).flatMap((line) => {
    const item = /^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/.exec(line)
    return item ? referencesIn(item[1]!, repository).slice(0, 1) : []
  })
}

/** The issues of a `Blocked by: #<n>, #<n>` line in a Ticket body. */
function blockedByLineOf(ticket: Issue, repository: string): Reference[] {
  const line = /^\s*Blocked by\s*:?\s*(.*)$/im.exec(ticket.body ?? '')
  return line ? referencesIn(line[1]!, repository) : []
}

/** Runs one call per item, a few at a time, keeping the items' order. */
async function eachLimited<T, R>(items: T[], call: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += CONCURRENT_CALLS) {
    results.push(...(await Promise.all(items.slice(start, start + CONCURRENT_CALLS).map(call))))
  }
  return results
}

export function createGitHubTracker(gh: Gh) {
  // A Project's folder keeps its repository, and gh its account: each asked once.
  const repositories = new Map<string, string>()
  let signedInAs: string | undefined

  async function repositoryOf(project: string): Promise<string> {
    const known = repositories.get(project)
    if (known) return known
    let output: string
    try {
      output = await gh(['repo', 'view', '--json', 'nameWithOwner'], project)
    } catch (error) {
      // Not a git folder, no remote, or no remote on a GitHub host.
      if (error instanceof GhError && error.problem === 'gh-failed' && /\bgit\b|remote/i.test(error.message)) {
        throw new GhError('no-github-repository', error.message)
      }
      throw error
    }
    const { nameWithOwner } = JSON.parse(output) as { nameWithOwner: string }
    repositories.set(project, nameWithOwner)
    return nameWithOwner
  }

  async function get<T>(project: string, route: string): Promise<T> {
    return JSON.parse(await gh(['api', '--method', 'GET', route], project)) as T
  }

  /** Every item of a listing endpoint, all pages joined. */
  async function list<T>(project: string, route: string, params: Record<string, string> = {}): Promise<T[]> {
    const fields = Object.entries({ per_page: '100', ...params }).flatMap(([key, value]) => ['-f', `${key}=${value}`])
    const output = await gh(['api', '--method', 'GET', route, ...fields, '--paginate', '--slurp'], project)
    return (JSON.parse(output) as T[][]).flat()
  }

  /** A Map's sub-issues; none where the repository's host has no sub-issues. */
  async function subIssuesOf(project: string, mapRoute: string): Promise<Issue[]> {
    try {
      return await list<Issue>(project, `${mapRoute}/sub_issues`)
    } catch (error) {
      if (error instanceof GhError && error.problem === 'gh-failed' && /HTTP 404/.test(error.message)) return []
      throw error
    }
  }

  async function user(project: string): Promise<string> {
    signedInAs ??= (await get<{ login: string }>(project, 'user')).login
    return signedInAs
  }

  async function readMap(project: string, mapId: string): Promise<MapRecord> {
    if (!/^\d+$/.test(mapId)) throw new Error(`No Map numbered ${mapId} in ${project}`)
    const repository = await repositoryOf(project)
    const issueRoute = (ref: Reference): string => `repos/${ref.repository}/issues/${ref.number}`
    const [map, login] = await Promise.all([
      get<Issue>(project, issueRoute({ repository, number: Number(mapId) })),
      user(project)
    ])
    if (map.pull_request || !map.labels.some((label) => label.name === MAP_LABEL)) {
      throw new Error(`Issue #${mapId} of ${repository} is not a Map`)
    }

    let children = await subIssuesOf(project, issueRoute({ repository, number: map.number }))
    if (children.length === 0) {
      children = await eachLimited(taskListOf(map, repository), (ref) => get<Issue>(project, issueRoute(ref)))
    }

    // Within the repository a Ticket is its number; beyond it, `owner/repo#n`.
    const idOf = (ref: Reference): string =>
      ref.repository.toLowerCase() === repository.toLowerCase() ? String(ref.number) : `${ref.repository}#${ref.number}`
    const ids = new Set(children.map((child) => idOf({ repository: repositoryOfIssue(child), number: child.number })))
    const openOutside = new Set<string>()
    // Issues outside the Map that a `Blocked by:` line names, whose state only the issue itself gives.
    const named = new Map<string, Reference>()

    // Native dependencies come with their blockers' state.
    const blockersOf = async (child: Issue): Promise<string[]> => {
      if ((child.issue_dependencies_summary?.total_blocked_by ?? 0) > 0) {
        const route = `${issueRoute({ repository: repositoryOfIssue(child), number: child.number })}/dependencies/blocked_by`
        return (await list<Issue>(project, route)).map((blocker) => {
          const id = idOf({ repository: repositoryOfIssue(blocker), number: blocker.number })
          if (!ids.has(id) && blocker.state === 'open') openOutside.add(id)
          return id
        })
      }
      return blockedByLineOf(child, repository).map((ref) => {
        const id = idOf(ref)
        if (!ids.has(id)) named.set(id, ref)
        return id
      })
    }
    const blockedBy = await eachLimited(children, blockersOf)
    await eachLimited([...named], async ([id, ref]) => {
      if ((await get<Issue>(project, issueRoute(ref))).state === 'open') openOutside.add(id)
    })

    const tickets = children.map((child, index): TicketRecord => {
      const body = child.body ?? ''
      const sections = sectionsOf(body)
      const type = child.labels.map((label) => /^wayfinder:(.+)$/i.exec(label.name)?.[1]?.toLowerCase())
      const logins = child.assignees.map((assignee) => assignee.login)
      return {
        id: idOf({ repository: repositoryOfIssue(child), number: child.number }),
        name: child.title,
        type: TICKET_TYPES.find((known) => type.includes(known)) ?? null,
        open: child.state === 'open',
        claimed: logins.length > 0,
        claimedByUser: logins.includes(login),
        // The user first, when they are one of several assignees.
        assignee: logins.includes(login) ? login : (logins[0] ?? null),
        blockedBy: [...new Set(blockedBy[index])],
        path: child.html_url,
        question: questionOf(body, sections, METADATA_LINE),
        answer: sections.answer ?? ''
      }
    })

    return {
      ...summaryOf(map),
      updatedAt: Math.max(Date.parse(map.updated_at), ...children.map((child) => Date.parse(child.updated_at))),
      sections: sectionsOf(map.body ?? ''),
      tickets,
      openOutside: [...openOutside]
    }
  }

  return {
    async listMaps(project: string): Promise<MapSummary[]> {
      const repository = await repositoryOf(project)
      const issues = await list<Issue>(project, `repos/${repository}/issues`, { labels: MAP_LABEL, state: 'all' })
      return issues
        .filter((issue) => !issue.pull_request)
        .map(summaryOf)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    readMap
  }
}
