import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import type { ProjectSessions, SessionSummary, Tracker, WayfinderLink } from '../../src/shared/api'
import { commandForLevel, commandForTicket } from '../../src/shared/wayfinder-reference'
import { createFakeEnvironment, encodeProjectPath, wayfinderCommand, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const WEEK_VIEW_SESSION = 'e5b8c1d0-2f4a-4b6c-8d9e-0a1b2c3d4e5f'
const CHART_SESSION = '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7'
const AUDIT_SESSION = '6d7e8f90-a1b2-4c3d-94e5-f6a7b8c9d0e1'

/** A message the user typed, as Claude Code records it. */
const user = (timestamp: string, content: unknown): object => ({ type: 'user', timestamp, message: { role: 'user', content } })

/** A `/wayfinder` invocation, as Claude Code records the slash command. */
const wayfinder = (timestamp: string, args: string): object => user(timestamp, wayfinderCommand(args))

describe('the Session ↔ Ticket link', () => {
  let env: FakeEnvironment
  let backend: Backend

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    backend?.dispose()
    await env.dispose()
  })

  /** Writes a Session's history in a recipe-box folder, each entry carrying that folder. */
  const writeHistory = (id: string, entries: object[], cwd = env.projects['recipe-box']): Promise<void> =>
    env.writeHistory(cwd, id, entries.map((entry) => ({ cwd, ...entry })))

  const session = async (id: string): Promise<SessionSummary | undefined> =>
    (await backend.api.sessions.list()).flatMap((project) => project.sessions).find((s) => s.id === id)

  it('links a Session to the Map and Ticket its /wayfinder invocation names, even from a worktree', async () => {
    backend = startBackend(env)

    expect((await session(WEEK_VIEW_SESSION))?.wayfinder).toEqual({
      mapId: 'meal-planner',
      mapName: 'Meal planner',
      ticket: { id: '02', name: 'Shape of the week view' }
    })
  })

  it('links a Session to a whole Map when its invocation, from a plugin, names no Ticket', async () => {
    await writeHistory(AUDIT_SESSION, [
      user('2026-10-24T09:00:00.000Z', [{ type: 'text', text: wayfinderCommand('pantry-audit', 'mattpocock-skills') }])
    ])
    backend = startBackend(env)

    expect((await session(AUDIT_SESSION))?.wayfinder).toEqual({ mapId: 'pantry-audit', mapName: 'Pantry audit', ticket: null })
  })

  it('follows the latest invocation of a long Session, however the Ticket is written', async () => {
    const chatter = Array.from({ length: 600 }, (_, i) =>
      ({ type: 'assistant', timestamp: '2026-10-24T09:30:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: `Step ${i} ${'.'.repeat(400)}` }] } })
    )
    await writeHistory(AUDIT_SESSION, [
      wayfinder('2026-10-24T09:00:00.000Z', 'meal-planner 03'),
      ...chatter,
      wayfinder('2026-10-24T10:00:00.000Z', '.scratch/meal-planner/map.md #4'),
      ...chatter.slice(0, 20)
    ])
    backend = startBackend(env)

    expect((await session(AUDIT_SESSION))?.wayfinder).toEqual({
      mapId: 'meal-planner',
      mapName: 'Meal planner',
      ticket: { id: '04', name: 'Grocery list format' }
    })
  })

  it('links only the Map when the Ticket named is not on it, and nothing when no Map of the Project is named', async () => {
    await writeHistory(AUDIT_SESSION, [wayfinder('2026-10-24T09:00:00.000Z', 'meal-planner 42')])
    await writeHistory(CHART_SESSION, [wayfinder('2026-10-24T09:00:00.000Z', 'Plan a garden for the herbs')])
    backend = startBackend(env)

    expect((await session(AUDIT_SESSION))?.wayfinder).toEqual({ mapId: 'meal-planner', mapName: 'Meal planner', ticket: null })
    expect((await session(CHART_SESSION))?.wayfinder).toBeNull()
  })

  it('links no Map to a Session that never invoked /wayfinder', async () => {
    backend = startBackend(env)

    expect((await session(CHART_SESSION))?.wayfinder).toBeNull()
  })

  it('pushes the link as soon as a Session invokes /wayfinder', async () => {
    backend = startBackend(env)
    const pushed: ProjectSessions[][] = []
    backend.on('sessions.changed', (projects) => pushed.push(projects))
    await backend.api.sessions.list()

    const history = join(env.claudeHome, 'projects', encodeProjectPath(env.projects['recipe-box']), `${CHART_SESSION}.jsonl`)
    const invocation = { sessionId: CHART_SESSION, cwd: env.projects['recipe-box'], ...wayfinder('2026-10-25T09:00:00.000Z', 'meal-planner 05') }
    await appendFile(history, JSON.stringify(invocation) + '\n')

    await vi.waitFor(
      () => {
        const chart = pushed.at(-1)?.flatMap((project) => project.sessions).find((s) => s.id === CHART_SESSION)
        expect(chart?.wayfinder?.ticket).toEqual({ id: '05', name: 'Portion sizes per household' })
      },
      { timeout: 8_000, interval: 50 }
    )
  })
})

describe('a /wayfinder reference, from the command the Map panel types to the link its Session gets', () => {
  let env: FakeEnvironment
  let backend: Backend

  const issueFile = (repository: string, ...path: string[]): string =>
    join(env.ghRecordings, 'api', 'repos', ...repository.split('/'), 'issues', ...path)
  const readJson = async <T = object>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
  const writeJson = async (file: string, value: unknown): Promise<void> => {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value))
  }

  /** Parent Ticket `fixture/gateway#12`, of another repository, beneath #71 of Map #70 and holding `fixture/gateway#13`. */
  async function addCrossRepositorySubTicket(): Promise<void> {
    const template = await readJson(issueFile('fixture/harbor-api', '74.json'))
    const gateway = (number: number, title: string, subTickets: number): object => ({
      ...template,
      url: `https://api.github.com/repos/fixture/gateway/issues/${number}`,
      repository_url: 'https://api.github.com/repos/fixture/gateway',
      html_url: `https://github.com/fixture/gateway/issues/${number}`,
      number,
      title,
      assignees: [],
      sub_issues_summary: { total: subTickets, completed: 0, percent_completed: 0 }
    })
    const retryBudget = gateway(12, 'Retry budget', 1)
    const backoff = gateway(13, 'Backoff curve', 0)
    const delivery = issueFile('fixture/harbor-api', '71', 'sub_issues.json')
    await writeJson(delivery, [...(await readJson<object[]>(delivery)), retryBudget])
    await writeJson(issueFile('fixture/gateway', '12.json'), retryBudget)
    await writeJson(issueFile('fixture/gateway', '12', 'parent.json'), await readJson(issueFile('fixture/harbor-api', '71.json')))
    await writeJson(issueFile('fixture/gateway', '12', 'sub_issues.json'), [backoff])
    await writeJson(issueFile('fixture/gateway', '13.json'), backoff)
    await writeJson(issueFile('fixture/gateway', '13', 'parent.json'), retryBudget)
  }

  /** A `family cookbook` effort in recipe-box, a folder name with a space, whose Ticket 01 is a Parent Ticket. */
  async function addFamilyCookbook(): Promise<void> {
    const folder = join(env.projects['recipe-box'], '.scratch', 'family cookbook')
    await mkdir(join(folder, 'issues'), { recursive: true })
    await writeFile(join(folder, 'map.md'), '# Family cookbook\n\n## Destination\n\nPrint the household’s recipes.\n')
    await writeFile(join(folder, 'issues', '01-chapter order.md'), '# Chapter order\n\nType: grilling\n')
    await writeFile(join(folder, 'issues', '02-index.md'), '# Index style\n\nType: research\nParent: 01\n')
  }

  beforeEach(async () => {
    env = await createFakeEnvironment()
    await Promise.all([addCrossRepositorySubTicket(), addFamilyCookbook()])
    backend = startBackend(env)
  })

  afterEach(async () => {
    backend?.dispose()
    await env.dispose()
  })

  type Project = 'harbor-api' | 'recipe-box'
  const TRACKERS: Record<Project, Tracker> = { 'harbor-api': { kind: 'github' }, 'recipe-box': { kind: 'local-markdown' } }

  /** What the Map panel types to start one Ticket of a Map, or to work that Ticket's level as a Map of its own. */
  async function typed(project: Project, mapId: string, ticketId: string, as: 'ticket' | 'level'): Promise<string> {
    const map = await backend.api.map.load(env.projects[project], mapId)
    const ticket = map.tickets.find((each) => each.id === ticketId)!
    const command =
      as === 'ticket'
        ? commandForTicket(TRACKERS[project], map.id, ticket)
        : commandForLevel(TRACKERS[project], env.projects[project], ticket)
    expect(command).not.toBeNull()
    return command!
  }

  const WEBHOOKS = { mapId: '70', mapName: 'Webhooks' }
  const MEAL_PLANNER = { mapId: 'meal-planner', mapName: 'Meal planner' }
  const FAMILY_COOKBOOK = { mapId: 'family cookbook', mapName: 'Family cookbook' }

  interface Row {
    invocation: string
    project: Project
    /** The command: the Map panel's where it writes one, else as typed by hand or by Wayfinder. */
    command: () => Promise<string> | string
    plugin?: string
    link: WayfinderLink | null
  }

  const ROWS: Row[] = [
    { invocation: '#70, a Map', project: 'harbor-api', command: () => '/wayfinder #70', link: { ...WEBHOOKS, ticket: null } },
    {
      invocation: '#70 #72',
      project: 'harbor-api',
      command: () => '/wayfinder #70 #72',
      link: { ...WEBHOOKS, ticket: { id: '72', name: 'Signing secrets' } }
    },
    {
      invocation: 'a Frontier Ticket of Map #70, as the Map panel starts it',
      project: 'harbor-api',
      command: () => typed('harbor-api', '70', '77', 'ticket'),
      link: { ...WEBHOOKS, ticket: { id: '77', name: 'Replay tool' } }
    },
    {
      invocation: '#71, Parent Ticket of Map #70 worked as a Map',
      project: 'harbor-api',
      command: () => typed('harbor-api', '70', '71', 'level'),
      link: { ...WEBHOOKS, ticket: { id: '71', name: 'Delivery guarantees' } }
    },
    {
      invocation: '#71 #75, a Sub-ticket of 71',
      project: 'harbor-api',
      command: () => '/wayfinder #71 #75',
      link: { ...WEBHOOKS, ticket: { id: '75', name: 'Dead-letter queue' } }
    },
    {
      invocation: 'a Sub-ticket of another repository worked as a Map',
      project: 'harbor-api',
      command: () => typed('harbor-api', '70', 'fixture/gateway#12', 'level'),
      link: { ...WEBHOOKS, ticket: { id: 'fixture/gateway#12', name: 'Retry budget' } }
    },
    {
      invocation: 'an issue URL, then a bare number',
      project: 'harbor-api',
      command: () => '/wayfinder https://github.com/fixture/harbor-api/issues/70 74',
      link: { ...WEBHOOKS, ticket: { id: '74', name: 'Ordering of events' } }
    },
    {
      invocation: 'meal-planner 02, as the Map panel starts it',
      project: 'recipe-box',
      command: () => typed('recipe-box', 'meal-planner', '02', 'ticket'),
      link: { ...MEAL_PLANNER, ticket: { id: '02', name: 'Shape of the week view' } }
    },
    {
      invocation: 'a Ticket’s markdown path',
      project: 'recipe-box',
      command: () => '/wayfinder .scratch/meal-planner/issues/03-leftovers.md',
      link: { ...MEAL_PLANNER, ticket: { id: '03', name: 'Carry leftovers to the next day' } }
    },
    {
      invocation: 'a quoted Parent Ticket path with a space, worked as a Map',
      project: 'recipe-box',
      command: () => typed('recipe-box', 'family cookbook', '01', 'level'),
      link: { ...FAMILY_COOKBOOK, ticket: { id: '01', name: 'Chapter order' } }
    },
    {
      invocation: 'a Ticket of a Map whose effort has a space',
      project: 'recipe-box',
      command: () => typed('recipe-box', 'family cookbook', '02', 'ticket'),
      link: { ...FAMILY_COOKBOOK, ticket: { id: '02', name: 'Index style' } }
    },
    {
      invocation: '/plugin:wayfinder #70 #72',
      project: 'harbor-api',
      command: () => '/wayfinder #70 #72',
      plugin: 'mattpocock-skills',
      link: { ...WEBHOOKS, ticket: { id: '72', name: 'Signing secrets' } }
    },
    {
      invocation: 'a Ticket worked as a Map, then one its Map does not hold',
      project: 'harbor-api',
      command: () => '/wayfinder #71 #99',
      link: { ...WEBHOOKS, ticket: { id: '71', name: 'Delivery guarantees' } }
    },
    {
      invocation: 'a Map, then a path into another effort',
      project: 'recipe-box',
      command: () => '/wayfinder meal-planner .scratch/pantry-audit/issues/01-shelf-labels.md',
      link: { ...MEAL_PLANNER, ticket: null }
    },
    { invocation: 'plan a meal app', project: 'recipe-box', command: () => '/wayfinder plan a meal app', link: null },
    { invocation: '3 ideas for dinner', project: 'recipe-box', command: () => '/wayfinder 3 ideas for dinner', link: null },
    { invocation: 'plan webhook retries', project: 'harbor-api', command: () => '/wayfinder plan webhook retries', link: null }
  ]

  it.each(ROWS)('$invocation', async ({ project, command, plugin, link }) => {
    const text = await command()
    expect(text).toMatch(/^\/wayfinder /)
    const cwd = env.projects[project]
    await env.writeHistory(cwd, AUDIT_SESSION, [
      { cwd, ...user('2026-10-24T09:00:00.000Z', wayfinderCommand(text.replace(/^\/wayfinder /, ''), plugin)) }
    ])

    const sessions = (await backend.api.sessions.list()).flatMap((each) => each.sessions)
    expect(sessions.find((s) => s.id === AUDIT_SESSION)?.wayfinder).toEqual(link)
  })

  it('writes a GitHub issue as #n or owner/repo#n, and quotes a reference holding a space', async () => {
    expect(await typed('harbor-api', '70', '77', 'ticket')).toBe('/wayfinder #70 #77')
    expect(await typed('harbor-api', '70', '71', 'level')).toBe('/wayfinder #71')
    expect(await typed('harbor-api', '70', 'fixture/gateway#12', 'level')).toBe('/wayfinder fixture/gateway#12')
    expect(await typed('recipe-box', 'family cookbook', '02', 'ticket')).toBe('/wayfinder "family cookbook" 02')
    expect(await typed('recipe-box', 'family cookbook', '01', 'level')).toBe(
      '/wayfinder ".scratch/family cookbook/issues/01-chapter order.md"'
    )
  })
})
