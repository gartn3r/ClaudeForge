// The Work items card's backlog, read through the user's `az` (ADR 0008): the Current sprint under
// the iteration root, its Work items, and the choices the configuration form offers.

import type { BacklogApi } from '../../shared/api'
import {
  classificationPath,
  currentSprint,
  localDate,
  organizationUrl,
  parseWorkItems,
  pathsIn,
  sprintsIn,
  workItemsQuery
} from '../../shared/work-items'
import { AzError, type Az } from './az'

/** How deep sprints may sit under the iteration root, year folders included. */
const SPRINT_DEPTH = 4

/** How deep the form looks for areas and iteration roots. */
const CHOICE_DEPTH = 6

/** An `az` answer as JSON; a failure as the problem it is. */
async function azJson(az: Az, args: string[]): Promise<unknown> {
  const stdout = await az([...args, '--output', 'json'])
  try {
    return JSON.parse(stdout)
  } catch {
    throw new AzError('az-failed', `az printed something other than JSON: ${stdout.slice(0, 200)}`)
  }
}

/** Runs a read, giving back an `az` failure as data the interface can show. */
async function failing<T>(read: () => Promise<T>): Promise<T | { ok: false; problem: AzError['problem']; detail: string }> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof AzError) return { ok: false, problem: error.problem, detail: error.message }
    return { ok: false, problem: 'az-failed', detail: error instanceof Error ? error.message : String(error) }
  }
}

export function createBacklogService(az: Az, now: () => Date = () => new Date()): BacklogApi {
  const scope = (organization: string, project?: string): string[] => [
    '--org',
    organizationUrl(organization),
    ...(project === undefined ? [] : ['--project', project])
  ]

  const tree = (organization: string, project: string, kind: 'iteration' | 'area', path: string, depth: number): Promise<unknown> =>
    azJson(az, [
      'boards',
      kind,
      'project',
      'list',
      ...scope(organization, project),
      '--path',
      classificationPath(path, kind === 'iteration' ? 'Iteration' : 'Area'),
      '--depth',
      String(depth)
    ])

  return {
    workItems: (config) =>
      failing(async () => {
        const iterations = await tree(config.organization, config.project, 'iteration', config.iterationRoot, SPRINT_DEPTH)
        const current = currentSprint(sprintsIn(iterations), localDate(now()))
        if (!current) return { ok: true, sprint: null, upcoming: false, workItems: [] }
        const answer = await azJson(az, [
          'boards',
          'query',
          ...scope(config.organization, config.project),
          '--wiql',
          workItemsQuery(config, current.sprint.path)
        ])
        return { ok: true, ...current, workItems: parseWorkItems(answer) }
      }),
    projects: (organization) =>
      failing(async () => {
        const answer = (await azJson(az, ['devops', 'project', 'list', ...scope(organization)])) as { value?: unknown }
        const projects = Array.isArray(answer?.value) ? answer.value : []
        const names = projects.flatMap((project) => (typeof project?.name === 'string' ? [project.name as string] : []))
        return { ok: true, values: names.sort((a, b) => a.localeCompare(b)) }
      }),
    areas: (organization, project) =>
      failing(async () => ({ ok: true, values: pathsIn(await tree(organization, project, 'area', project, CHOICE_DEPTH), 'all') })),
    iterationRoots: (organization, project) =>
      failing(async () => ({
        ok: true,
        values: pathsIn(await tree(organization, project, 'iteration', project, CHOICE_DEPTH), 'folders')
      }))
  }
}
