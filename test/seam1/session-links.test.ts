import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../../src/backend'
import type { ProjectSessions, SessionSummary } from '../../src/shared/api'
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
