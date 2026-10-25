import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import { createFakeEnvironment, type FakeEnvironment, type FakeEnvironmentOptions } from '../fake-env'
import { startBackend } from './backend'

// harbor-api's Tracker is GitHub Issues in fixture/harbor-api, read through the fake `gh`
// replaying JSON recorded from the GitHub REST API (test/fixtures/gh).
describe('Map service on a GitHub Tracker', () => {
  let env: FakeEnvironment
  let backend: Backend

  const start = async (options?: FakeEnvironmentOptions): Promise<Backend> => {
    env = await createFakeEnvironment(options)
    backend = startBackend(env)
    return backend
  }

  afterEach(async () => {
    backend.dispose()
    await env.dispose()
  })

  const issue = (number: number): string => `https://github.com/fixture/harbor-api/issues/${number}`

  it('lists the issues labelled wayfinder:map, most recently updated first', async () => {
    const listing = await (await start()).api.map.list(env.projects['harbor-api'])

    expect(listing).toEqual({
      tracker: { kind: 'github' },
      maps: [
        { id: '40', name: 'Rate limiting', path: issue(40), updatedAt: Date.parse('2026-10-20T09:00:00Z'), open: true },
        { id: '60', name: 'Audit log', path: issue(60), updatedAt: Date.parse('2026-10-15T09:00:00Z'), open: true },
        { id: '20', name: 'Legacy auth removal', path: issue(20), updatedAt: Date.parse('2026-09-01T09:00:00Z'), open: false }
      ]
    })
  })

  describe('loading a Map', () => {
    const load = async (mapId = '40'): ReturnType<Backend['api']['map']['load']> =>
      (await start()).api.map.load(env.projects['harbor-api'], mapId)

    it('reads the Destination and the sections of the Map issue', async () => {
      const map = await load()

      expect(map).toMatchObject({
        id: '40',
        name: 'Rate limiting',
        path: issue(40),
        open: true,
        destination: 'Every public endpoint is rate limited per tenant, with limits clients can read.',
        notes: 'Limits apply per API key; anonymous traffic is out of scope for now.',
        decisionsSoFar:
          `- [Where limits are enforced](${issue(41)}): at the gateway.\n` +
          `- [Retry-After semantics](${issue(46)}): seconds, never a date.`,
        notYetSpecified: '- How limits change for paying tenants.',
        outOfScope: '- Billing for overages.'
      })
    })

    it('reads its sub-issues as Tickets, in Map order: type label, state, assignee and blockers', async () => {
      const { tickets } = await load()

      expect(
        tickets.map(({ id, name, type, open, claimed, assignee, blockedBy }) => ({ id, name, type, open, claimed, assignee, blockedBy }))
      ).toEqual([
        { id: '41', name: 'Where limits are enforced', type: 'grilling', open: false, claimed: false, assignee: null, blockedBy: [] },
        { id: '42', name: 'Shape of the limit headers', type: 'prototype', open: true, claimed: false, assignee: null, blockedBy: [] },
        { id: '43', name: 'Burst allowance', type: 'research', open: true, claimed: false, assignee: null, blockedBy: ['42'] },
        { id: '44', name: 'Per-tenant quotas', type: 'task', open: true, claimed: true, assignee: 'fixture-user', blockedBy: ['41'] },
        { id: '45', name: 'Admin override', type: 'task', open: true, claimed: true, assignee: 'dana-reyes', blockedBy: [] },
        { id: '46', name: 'Retry-After semantics', type: 'research', open: false, claimed: false, assignee: null, blockedBy: ['42'] },
        // Native dependencies absent, so from the `Blocked by:` line, naming an issue outside the Map.
        { id: '47', name: 'Quota dashboard', type: 'grilling', open: true, claimed: false, assignee: null, blockedBy: ['43', '30'] },
        // Blocked by an issue of another repository.
        { id: '48', name: 'Gateway rollout', type: 'task', open: true, claimed: false, assignee: null, blockedBy: ['fixture/gateway#7'] }
      ])
      expect(tickets[0]).toMatchObject({
        path: issue(41),
        question: 'Are limits enforced at the gateway or in each service?',
        answer: 'At the gateway.'
      })
      expect(tickets.find((ticket) => ticket.id === '47')).toMatchObject({
        question: 'What does a tenant see of its own usage?',
        answer: ''
      })
    })

    it('derives each Ticket state; only a Ticket claimed by the signed-in user is workable', async () => {
      const { tickets } = await load()

      expect(tickets.map(({ id, state, workable, openBlockers }) => ({ id, state, workable, openBlockers }))).toEqual([
        { id: '41', state: 'closed', workable: false, openBlockers: 0 },
        { id: '42', state: 'frontier', workable: true, openBlockers: 0 },
        { id: '43', state: 'blocked', workable: false, openBlockers: 1 },
        // Claimed by fixture-user, whom gh is signed in as, with a closed blocker.
        { id: '44', state: 'claimed', workable: true, openBlockers: 0 },
        // Claimed by someone else.
        { id: '45', state: 'claimed', workable: false, openBlockers: 0 },
        // Closed wins over its still-open blocker.
        { id: '46', state: 'closed', workable: false, openBlockers: 1 },
        // An open issue outside the Map blocks as much as an open Ticket of it.
        { id: '47', state: 'blocked', workable: false, openBlockers: 2 },
        { id: '48', state: 'blocked', workable: false, openBlockers: 1 }
      ])
    })

    it('puts closed Tickets in the Decided set and draws edges only between Tickets of the Map', async () => {
      const map = await load()

      expect(map.decided).toEqual(['41', '46'])
      expect(map.liveEdges).toEqual([
        { from: '42', to: '43' },
        { from: '43', to: '47' }
      ])
      expect(map.spentEdges).toEqual([
        { from: '41', to: '44' },
        { from: '42', to: '46' }
      ])
    })

    // Its task list also names #63, which has been deleted, and an acceptance item mentioning #30.
    it('falls back to the top-level task list of the Map body, leaving out issues it cannot read', async () => {
      const map = await load('60')

      expect(map.tickets.map(({ id, name, type, state, blockedBy }) => ({ id, name, type, state, blockedBy }))).toEqual([
        { id: '61', name: 'What counts as an admin action', type: 'grilling', state: 'closed', blockedBy: [] },
        { id: '62', name: 'Audit entry format', type: 'task', state: 'frontier', blockedBy: ['61'] }
      ])
      expect(map.tickets[1]?.question).toBe('What fields does an audit entry carry?')
      expect(map.spentEdges).toEqual([{ from: '61', to: '62' }])
    })

    it('refuses an id that is not a Map issue of the repository', async () => {
      await expect(load('30')).rejects.toThrow()
      await expect(backend.api.map.load(env.projects['harbor-api'], '../40')).rejects.toThrow()
    })

    it('only reads through gh, never writing to the Tracker', async () => {
      await load()

      // gh api sends a request with fields as a POST unless told otherwise.
      const methodOf = (args: string[]): string => {
        const flag = args.findIndex((arg) => arg === '--method' || arg === '-X')
        if (flag >= 0) return args[flag + 1]!
        return args.some((arg) => /^(-f|-F|--field|--raw-field|--input)$/.test(arg)) ? 'POST' : 'GET'
      }
      for (const { args } of await env.invocations('gh')) {
        if (args[0] === 'api') expect(methodOf(args)).toBe('GET')
        else expect(args.slice(0, 2)).toEqual(['repo', 'view'])
      }
    })
  })

  describe('when gh cannot read the Tracker', () => {
    it('says the GitHub CLI is signed out', async () => {
      const listing = await (await start({ gh: 'signed-out' })).api.map.list(env.projects['harbor-api'])

      expect(listing).toEqual({ tracker: { kind: 'github' }, problem: 'gh-signed-out', maps: [] })
    })

    it('says the GitHub CLI is missing', async () => {
      const listing = await (await start({ gh: false })).api.map.list(env.projects['harbor-api'])

      expect(listing).toEqual({ tracker: { kind: 'github' }, problem: 'gh-missing', maps: [] })
    })

    it('says gh finds no GitHub repository for the Project', async () => {
      await start()
      await mkdir(join(env.projects.dotfiles, 'docs', 'agents'), { recursive: true })
      await writeFile(join(env.projects.dotfiles, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker: GitHub\n')

      const listing = await backend.api.map.list(env.projects.dotfiles)

      expect(listing).toEqual({ tracker: { kind: 'github' }, problem: 'no-github-repository', maps: [] })
    })

    it('refuses to load a Map', async () => {
      const { api } = await start({ gh: 'signed-out' })

      await expect(api.map.load(env.projects['harbor-api'], '40')).rejects.toThrow(/gh auth login/)
    })
  })
})
