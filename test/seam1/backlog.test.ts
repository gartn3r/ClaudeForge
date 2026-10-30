import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import { azCommand, azProblem } from '../../src/backend/backlog/az'
import type { BacklogConfig, WorkItemAction } from '../../src/shared/api'
import { localDate } from '../../src/shared/work-items'
import { createFakeEnvironment, type FakeEnvironment, type FakeEnvironmentOptions } from '../fake-env'
import { startBackend } from './backend'

/** The fake `az`'s organisation, as `test/fixtures/az` records it. */
const config: BacklogConfig = {
  organization: 'https://devops.example.test/fixture-org',
  project: 'Harbor',
  areaPath: 'Harbor\\Platform & Ops',
  iterationRoot: 'Harbor\\Team Rocket'
}

const action = (fields: Partial<WorkItemAction> = {}): WorkItemAction => ({
  id: 'analyse',
  label: 'Analyse',
  skill: 'analyze-ticket',
  text: 'analyse #{id}',
  colour: 'outline',
  ...fields
})

/** A day relative to today, as the fake `az` writes it. */
const day = (offset: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return localDate(date)
}

describe('the Work items card’s backlog', () => {
  let env: FakeEnvironment
  const backends: Backend[] = []

  const start = (): Backend => {
    const backend = startBackend(env)
    backends.push(backend)
    return backend
  }

  const setUp = async (options?: FakeEnvironmentOptions): Promise<void> => {
    await env?.dispose()
    env = await createFakeEnvironment(options)
  }

  /** Replaces the sprints under the iteration root, as Azure DevOps would once someone plans them. */
  const planSprints = async (sprints: Array<{ name: string; start: number; finish: number }>): Promise<void> => {
    const file = join(env.azRecordings, 'iterations.json')
    const tree = JSON.parse(await readFile(file, 'utf8'))
    const year = tree.children[0].children[0]
    year.children = sprints.map(({ name, start, finish }) => ({
      name,
      path: `${year.path}\\${name}`,
      attributes: { startDate: `{{today${start >= 0 ? '+' : ''}${start}}}T00:00:00Z`, finishDate: `{{today${finish >= 0 ? '+' : ''}${finish}}}T00:00:00Z` },
      children: null
    }))
    await writeFile(file, JSON.stringify(tree))
  }

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    for (const backend of backends.splice(0)) backend.dispose()
    await env.dispose()
  })

  it('keeps one configuration and the Work item actions across a restart, trimmed', async () => {
    const initial = await start().api.appState.read()
    expect(initial.backlog).toBeNull()
    expect(initial.workItemActions).toEqual([])

    await start().api.appState.write({
      backlog: { ...config, organization: ' fixture-org ', project: ' Harbor ' },
      workItemActions: [action({ label: ' Analyse ' }), action({ id: 'code', label: 'Code', colour: '#E58A7A' })]
    })

    const restarted = await start().api.appState.read()
    expect(restarted.backlog).toEqual(config)
    expect(restarted.workItemActions).toEqual([action(), action({ id: 'code', label: 'Code', colour: '#e58a7a' })])
  })

  it('forgets a configuration missing a field, and keeps three Work item actions at most', async () => {
    const { api } = start()
    await api.appState.write({ backlog: config })

    const forgotten = await api.appState.write({
      backlog: { ...config, areaPath: '' },
      workItemActions: ['a', 'b', 'c', 'd'].map((id) => action({ id }))
    })

    expect(forgotten.backlog).toBeNull()
    expect(forgotten.workItemActions.map((each) => each.id)).toEqual(['a', 'b', 'c'])
  })

  it('lists the Current sprint’s Work items in backlog order, accents intact, telling the user’s from the unassigned', async () => {
    const listing = await start().api.backlog.workItems(config)

    expect(listing).toMatchObject({
      ok: true,
      sprint: {
        name: 'Sprint 42',
        path: 'Harbor\\Team Rocket\\2026\\Sprint 42',
        start: day(-10),
        finish: day(4)
      },
      upcoming: false
    })
    if (!listing.ok) throw new Error('unreachable')
    expect(listing.workItems.slice(0, 3)).toEqual([
      { id: 1101, type: 'Product Backlog Item', state: 'To Do', title: 'Catalogue - Amélioration de l’indexation des références', assignedToMe: false },
      { id: 1102, type: 'Product Backlog Item', state: 'In Progress', title: 'Sauvegarde des exports hors du serveur', assignedToMe: true },
      { id: 1103, type: 'BugInnovation', state: 'In Code Review', title: 'Accueil connecté : le carrousel reste figé', assignedToMe: true }
    ])
    expect(listing.workItems).toHaveLength(7)
  })

  it('asks az for the iteration root’s sprints, then for that sprint’s Work items, a path holding & and quotes intact', async () => {
    await start().api.backlog.workItems({ ...config, areaPath: "Harbor\\Platform & Ops's" })

    const calls = (await env.invocations('az')).map((call) => call.args)
    expect(calls[0]).toEqual([
      'boards', 'iteration', 'project', 'list',
      '--org', 'https://devops.example.test/fixture-org', '--project', 'Harbor',
      '--path', '\\Harbor\\Iteration\\Team Rocket', '--depth', '4', '--output', 'json'
    ])
    expect(calls[1]!.slice(0, 7)).toEqual(['boards', 'query', '--org', 'https://devops.example.test/fixture-org', '--project', 'Harbor', '--wiql'])
    expect(calls[1]![7]).toContain(
      "[System.AreaPath] UNDER 'Harbor\\Platform & Ops''s' AND [System.IterationPath] = 'Harbor\\Team Rocket\\2026\\Sprint 42'"
    )
  })

  it('takes the next sprint, upcoming, between two sprints', async () => {
    await planSprints([
      { name: 'Sprint 42', start: -14, finish: -2 },
      { name: 'Sprint 43', start: 1, finish: 12 }
    ])

    const listing = await start().api.backlog.workItems(config)

    expect(listing).toMatchObject({ ok: true, sprint: { name: 'Sprint 43', start: day(1) }, upcoming: true })
  })

  it('finds no sprint when none under the iteration root runs or is to come, and asks for no Work item', async () => {
    await planSprints([{ name: 'Sprint 40', start: -30, finish: -16 }])

    const listing = await start().api.backlog.workItems(config)

    expect(listing).toEqual({ ok: true, sprint: null, upcoming: false, workItems: [] })
    expect((await env.invocations('az')).map((call) => call.args[1])).toEqual(['iteration'])
  })

  it('lists no Work item when the sprint has none left to take', async () => {
    await writeFile(join(env.azRecordings, 'work-items.json'), '[]')

    const listing = await start().api.backlog.workItems(config)

    expect(listing).toMatchObject({ ok: true, sprint: { name: 'Sprint 42' }, workItems: [] })
  })

  it('says when az is signed out, lacks its extension, is missing, or fails otherwise', async () => {
    await env.setAzMode('signed-out')
    expect(await start().api.backlog.workItems(config)).toMatchObject({ ok: false, problem: 'signed-out' })

    await env.setAzMode('no-extension')
    expect(await start().api.backlog.workItems(config)).toMatchObject({ ok: false, problem: 'extension-missing' })

    await env.setAzMode('signed-in')
    const unknown = await start().api.backlog.workItems({ ...config, organization: 'https://devops.example.test/nobody' })
    expect(unknown).toEqual({ ok: false, problem: 'az-failed', detail: 'The resource cannot be found.  Operation returned a 404 status code.' })

    await setUp({ az: false })
    expect(await start().api.backlog.workItems(config)).toMatchObject({ ok: false, problem: 'az-missing' })
  })

  it('offers the organisation’s projects, the project’s areas, and the iterations that hold sprints', async () => {
    const { api } = start()

    expect(await api.backlog.projects('fixture-org')).toEqual({ ok: true, values: ['Harbor', 'Maintenance'] })
    expect(await api.backlog.areas(config.organization, 'Harbor')).toEqual({
      ok: true,
      values: ['Harbor', 'Harbor\\Platform & Ops', 'Harbor\\Platform & Ops\\Gateway', 'Harbor\\Mobile']
    })
    expect(await api.backlog.iterationRoots(config.organization, 'Harbor')).toEqual({
      ok: true,
      values: ['Harbor', 'Harbor\\Team Rocket', 'Harbor\\Team Rocket\\2026']
    })
    expect(await api.backlog.projects('nobody')).toMatchObject({ ok: false, problem: 'az-failed' })
  })
})

describe('running az', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'claudeforge-az-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('runs the Windows installer’s Python itself, in UTF-8 mode, so accented titles come back intact', async () => {
    await mkdir(join(dir, 'wbin'))
    await writeFile(join(dir, 'wbin', 'az.cmd'), '')
    await writeFile(join(dir, 'python.exe'), '')

    expect(await azCommand(join(dir, 'wbin', 'az.cmd'))).toEqual({
      kind: 'program',
      file: join(dir, 'python.exe'),
      args: ['-X', 'utf8', '-IBm', 'azure.cli'],
      env: { AZ_INSTALLER: 'MSI' }
    })
  })

  it('runs any other az as it is', async () => {
    await writeFile(join(dir, 'az.cmd'), '')

    expect(await azCommand(join(dir, 'az.cmd'))).toEqual({ kind: 'batch', file: join(dir, 'az.cmd') })
    expect(await azCommand('/usr/bin/az')).toEqual({ kind: 'program', file: '/usr/bin/az', args: [], env: {} })
  })

  it('tells a missing extension and a missing sign-in apart from any other failure', () => {
    expect(azProblem("'boards' is misspelled or not recognized by the system.")).toBe('extension-missing')
    expect(azProblem('The command requires the extension azure-devops. Do you want to install it now?')).toBe('extension-missing')
    expect(azProblem('Before you can run Azure DevOps commands, you need to run the login command(az login if using AAD/MSA identity')).toBe(
      'signed-out'
    )
    expect(azProblem("Please run 'az login' to setup account.")).toBe('signed-out')
    expect(azProblem('The resource cannot be found.')).toBe('az-failed')
  })
})
