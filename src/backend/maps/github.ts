// The GitHub Tracker, as Wayfinder writes it (docs/agents/issue-tracker.md,
// "Wayfinding operations"): a Map is an issue labelled `wayfinder:map`, its
// Tickets are its sub-issues, blocking is GitHub's native issue dependencies,
// and `wayfinder:<type>` labels give the Ticket types. A Ticket's own
// sub-issues are its Sub-tickets, read as deep as they go (ADR 0004). Where
// sub-issues or dependencies are not available, Wayfinder falls back to a task
// list in the Map body and a `Blocked by: #<n>` line in the Ticket body.
// Everything is read through the REST API with `gh api`, in the Project's
// folder so `gh` finds its repository.

import type { MapSummary, TicketType } from '../../shared/api'
import type { WayfinderReference } from '../../shared/wayfinder-reference'
import { GhError, type Gh } from './gh'
import { questionOf, sectionsOf } from './markdown'
import type { MapRecord, TicketRecord } from './model'

const MAP_LABEL = 'wayfinder:map'
const TICKET_TYPES: readonly TicketType[] = ['research', 'prototype', 'grilling', 'task']
const METADATA_LINE = /^\s*(Part of|Blocked by)\b/i

const PAGE_SIZE = 100

/** How many `gh` calls run at once while a Map loads. */
const CONCURRENT_CALLS = 4

/** The fields ClaudeForge reads of a GitHub REST issue. */
interface Issue {
  number: number
  title: string
  html_url: string
  /** `https://api.<host>/repos/<owner>/<repo>`, or `https://<host>/api/v3/repos/…` on GitHub Enterprise Server. */
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

/** The repository a Project's folder belongs to, as `gh repo view` names it. */
interface Repository {
  /** `owner/repo` */
  name: string
  /** `github.com`, or a GitHub Enterprise Server host. */
  host: string
}

/** An issue read as a Ticket, with the id of the Ticket it is a Sub-ticket of. */
interface PlacedIssue {
  issue: Issue
  parent: string | null
}

/** An issue: `#<n>` of a repository. */
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

const referenceOf = (issue: Issue): Reference => ({
  repository: issue.repository_url.replace(/^.*\/repos\//, ''),
  number: issue.number
})

const issueRoute = ({ repository, number }: Reference): string => `repos/${repository}/issues/${number}`

/** The issue references in a piece of markdown, `#12`, `owner/repo#12` or an issue URL, `#12` meaning one of `repository`. */
function referencesIn(text: string, repository: string, host: string): Reference[] {
  const url = `https://${host.replace(/\./g, '\\.')}/([\\w.-]+/[\\w.-]+)/issues/`
  const pattern = new RegExp(`(?:${url}|(?<![\\w/#])([\\w.-]+/[\\w.-]+)?#)(\\d+)\\b`, 'g')
  return [...text.matchAll(pattern)].map((match) => ({
    repository: match[1] ?? match[2] ?? repository,
    number: Number(match[3])
  }))
}

/** Runs one call per item, a few at a time, keeping the items' order. */
async function eachLimited<T, R>(items: T[], call: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += CONCURRENT_CALLS) {
    results.push(...(await Promise.all(items.slice(start, start + CONCURRENT_CALLS).map(call))))
  }
  return results
}

const isNotFound = (error: unknown): boolean =>
  error instanceof GhError && error.problem === 'gh-failed' && /HTTP 404/.test(error.message)

export function createGitHubTracker(gh: Gh) {
  // A Project's folder keeps its repository: asked once per Project.
  const repositories = new Map<string, Repository>()

  async function repositoryOf(project: string): Promise<Repository> {
    const known = repositories.get(project)
    if (known) return known
    let output: string
    try {
      output = await gh(['repo', 'view', '--json', 'nameWithOwner,url'], project)
    } catch (error) {
      // Not a git folder, no remote, or no remote on a GitHub host.
      if (error instanceof GhError && error.problem === 'gh-failed' && /\bgit\b|remote/i.test(error.message)) {
        throw new GhError('no-github-repository', error.message)
      }
      throw error
    }
    const { nameWithOwner, url } = JSON.parse(output) as { nameWithOwner: string; url: string }
    const repository = { name: nameWithOwner, host: new URL(url).host }
    repositories.set(project, repository)
    return repository
  }

  /** Reads from the REST API of the Project's GitHub host. */
  function reader(project: string, { host }: Repository) {
    const hostname = host === 'github.com' ? [] : ['--hostname', host]
    const api = async (route: string, params: Record<string, string>): Promise<unknown> => {
      const fields = Object.entries(params).flatMap(([key, value]) => ['-f', `${key}=${value}`])
      return JSON.parse(await gh(['api', '--method', 'GET', ...hostname, route, ...fields], project))
    }
    return {
      get: async <T>(route: string): Promise<T> => (await api(route, {})) as T,
      /** Every item of a listing endpoint, page after page. */
      async list<T>(route: string, params: Record<string, string> = {}): Promise<T[]> {
        const items: T[] = []
        for (let page = 1; ; page++) {
          const batch = (await api(route, { ...params, per_page: String(PAGE_SIZE), page: String(page) })) as T[]
          items.push(...batch)
          if (batch.length < PAGE_SIZE) return items
        }
      }
    }
  }

  async function readMap(project: string, mapId: string): Promise<MapRecord> {
    if (!/^\d+$/.test(mapId)) throw new Error(`No Map numbered ${mapId} in ${project}`)
    const repository = await repositoryOf(project)
    const { get, list } = reader(project, repository)
    const [map, { login }] = await Promise.all([
      get<Issue>(issueRoute({ repository: repository.name, number: Number(mapId) })),
      get<{ login: string }>('user')
    ])
    if (map.pull_request || !map.labels.some((label) => label.name === MAP_LABEL)) {
      throw new Error(`Issue #${mapId} of ${repository.name} is not a Map`)
    }
    // An issue that cannot be read (deleted, or in a repository the user cannot see) is left out.
    const getIfFound = (ref: Reference): Promise<Issue | undefined> =>
      get<Issue>(issueRoute(ref)).catch((error: unknown) => {
        if (isNotFound(error)) return undefined
        throw error
      })

    let children: Issue[]
    try {
      children = await list<Issue>(`${issueRoute(referenceOf(map))}/sub_issues`)
    } catch (error) {
      // A GitHub host without sub-issues.
      if (!isNotFound(error)) throw error
      children = []
    }
    if (children.length === 0) {
      // The task list of the Map body: one Ticket per top-level item that starts with an issue reference.
      const items = (map.body ?? '').split(/\r?\n/).flatMap((line) => {
        const first = /^[-*+]\s+\[[ xX]\]\s+(\S+)/.exec(line)?.[1]
        return first ? referencesIn(first, repository.name, repository.host).slice(0, 1) : []
      })
      const found = await eachLimited(items, getIfFound)
      children = found.filter((issue): issue is Issue => issue !== undefined && !issue.pull_request)
    }

    // Within the Map's repository an issue is its number; beyond it, `owner/repo#n`, whatever the case it was written in.
    const idOf = (ref: Reference): string =>
      ref.repository.toLowerCase() === repository.name.toLowerCase()
        ? String(ref.number)
        : `${ref.repository.toLowerCase()}#${ref.number}`

    // Every Ticket in Map order: each one, then the Tickets beneath it, then its next sibling.
    const subIssuesOf = async (issue: Issue): Promise<Issue[]> =>
      (issue.sub_issues_summary?.total ?? 0) > 0
        ? (await list<Issue>(`${issueRoute(referenceOf(issue))}/sub_issues`)).filter((sub) => !sub.pull_request)
        : []
    const seen = new Set<string>()
    const descend = async (issues: Issue[], parent: string | null): Promise<PlacedIssue[]> => {
      const fresh = issues.filter((issue) => {
        const id = idOf(referenceOf(issue))
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      const below = await eachLimited(fresh, subIssuesOf)
      const placed: PlacedIssue[] = []
      for (const [index, issue] of fresh.entries()) {
        placed.push({ issue, parent }, ...(await descend(below[index]!, idOf(referenceOf(issue)))))
      }
      return placed
    }
    const placed = await descend(children, null)
    const issues = placed.map(({ issue }) => issue)
    const ids = new Set(issues.map((issue) => idOf(referenceOf(issue))))
    const openOutside = new Set<string>()
    // Issues outside the Map named by a `Blocked by:` line, whose state only the issue itself gives.
    const namedOutside = new Map<string, Reference>()

    // Native dependencies come with their blockers' state.
    const blockersOf = async (child: Issue): Promise<string[]> => {
      if ((child.issue_dependencies_summary?.total_blocked_by ?? 0) > 0) {
        return (await list<Issue>(`${issueRoute(referenceOf(child))}/dependencies/blocked_by`)).map((blocker) => {
          const id = idOf(referenceOf(blocker))
          if (!ids.has(id) && blocker.state === 'open') openOutside.add(id)
          return id
        })
      }
      const line = /^\s*Blocked by\s*:?\s*(.*)$/im.exec(child.body ?? '')?.[1] ?? ''
      // `#n` names an issue of the Ticket's own repository.
      return referencesIn(line, referenceOf(child).repository, repository.host).map((ref) => {
        const id = idOf(ref)
        if (!ids.has(id)) namedOutside.set(id, ref)
        return id
      })
    }
    const blockedBy = await eachLimited(issues, blockersOf)
    await eachLimited([...namedOutside], async ([id, ref]) => {
      if ((await getIfFound(ref))?.state === 'open') openOutside.add(id)
    })

    const tickets = placed.map(({ issue: child, parent }, index): TicketRecord => {
      const body = child.body ?? ''
      const sections = sectionsOf(body)
      const typeLabels = child.labels.map((label) => /^wayfinder:(.+)$/i.exec(label.name)?.[1]?.toLowerCase())
      const logins = child.assignees.map((assignee) => assignee.login)
      return {
        id: idOf(referenceOf(child)),
        name: child.title,
        type: TICKET_TYPES.find((known) => typeLabels.includes(known)) ?? null,
        open: child.state === 'open',
        claimed: logins.length > 0,
        claimedByUser: logins.includes(login),
        // The user first, when they are one of several assignees.
        assignee: logins.includes(login) ? login : (logins[0] ?? null),
        blockedBy: [...new Set(blockedBy[index])],
        parent,
        path: child.html_url,
        question: questionOf(body, sections, METADATA_LINE),
        answer: sections.answer ?? ''
      }
    })

    return { ...summaryOf(map), sections: sectionsOf(map.body ?? ''), tickets, openOutside: [...openOutside] }
  }

  /**
   * The Map holding the issue a reference names: its parent, its parent's parent and so on, up to
   * the first issue labelled `wayfinder:map`. Null when there is none, or it is not one of the
   * Project's own repository, where its Maps are.
   */
  async function mapHolding(project: string, reference: WayfinderReference): Promise<string | null> {
    const named =
      reference.kind === 'issue'
        ? reference
        : reference.kind === 'name' && /^\d+$/.test(reference.name)
          ? { repository: null, number: Number(reference.name) }
          : null
    if (!named) return null
    const repository = await repositoryOf(project)
    const { get } = reader(project, repository)
    let issue: Reference = { repository: named.repository ?? repository.name, number: named.number }
    const keyOf = (ref: Reference): string => `${ref.repository.toLowerCase()}#${ref.number}`
    // Issues already climbed through, so a cycle of parents ends.
    const seen = new Set<string>()
    while (!seen.has(keyOf(issue))) {
      seen.add(keyOf(issue))
      let parent: Issue
      try {
        parent = await get<Issue>(`${issueRoute(issue)}/parent`)
      } catch (error) {
        // An issue without a parent, or a GitHub host without sub-issues.
        if (isNotFound(error)) return null
        throw error
      }
      issue = referenceOf(parent)
      if (parent.labels.some((label) => label.name === MAP_LABEL)) {
        return issue.repository.toLowerCase() === repository.name.toLowerCase() ? String(issue.number) : null
      }
    }
    return null
  }

  return {
    async listMaps(project: string): Promise<MapSummary[]> {
      const repository = await repositoryOf(project)
      const issues = await reader(project, repository).list<Issue>(`repos/${repository.name}/issues`, {
        labels: MAP_LABEL,
        state: 'all'
      })
      return issues
        .filter((issue) => !issue.pull_request)
        .map(summaryOf)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    readMap,
    mapHolding
  }
}
