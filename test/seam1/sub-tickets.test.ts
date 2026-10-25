import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import type { WayfinderMap } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

/** Each Ticket's place in the tree and derived state. */
const treeOf = ({ tickets }: WayfinderMap) =>
  tickets.map(({ id, parent, state, workable, openBlockers, parentWaits }) => ({
    id,
    parent,
    state,
    workable,
    openBlockers,
    parentWaits
  }))

/** The roll-up of each Parent Ticket, by id. */
const rollupsOf = ({ tickets }: WayfinderMap) =>
  Object.fromEntries(tickets.flatMap((ticket) => (ticket.rollup ? [[ticket.id, ticket.rollup]] : [])))

describe('Sub-tickets', () => {
  let env: FakeEnvironment
  let backend: Backend

  beforeEach(async () => {
    env = await createFakeEnvironment()
    backend = startBackend(env)
  })

  afterEach(async () => {
    backend.dispose()
    await env.dispose()
  })

  describe('in a local markdown Map', () => {
    /** Writes a `cookbook` effort into recipe-box: its map.md and one file per Ticket, by file name. */
    const writeCookbook = async (tickets: Record<string, string>): Promise<void> => {
      const folder = join(env.projects['recipe-box'], '.scratch', 'cookbook')
      await mkdir(join(folder, 'issues'), { recursive: true })
      await writeFile(join(folder, 'map.md'), '# Cookbook\n\n## Destination\n\nPrint the household’s recipes as a cookbook.\n')
      for (const [file, text] of Object.entries(tickets)) await writeFile(join(folder, 'issues', file), text)
    }
    const load = (): Promise<WayfinderMap> => backend.api.map.load(env.projects['recipe-box'], 'cookbook')

    // Two levels under the Map, in the flat issues/ folder with the Map's single numbering (ADR 0004).
    const COOKBOOK = {
      '01-chapters.md': '# Chapter order\n\nType: grilling\nStatus: open\n',
      '02-printing.md': '# Printing\n\nType: task\nBlocked by: 01\n',
      '03-index.md': '# Index style\n\nType: research\nParent: 01\nStatus: resolved\n',
      '04-photos.md': '# Photos\n\nType: prototype\nParent: 1\nBlocked by: 03\n',
      '05-paper.md': '# Paper stock\n\nType: research\nParent: 02\n',
      '06-lighting.md': '# Lighting\n\nType: task\nParent: 04\nStatus: claimed\n',
      '07-framing.md': '# Framing\n\nType: grilling\nParent: 04\n',
      '08-credits.md': '# Recipe credits\n\nType: grilling\n',
      '09-sources.md': '# Sources\n\nType: research\nParent: 08\nStatus: resolved\n'
    }

    it('reads a Parent line as the Ticket’s parent, keeping every Ticket in number order', async () => {
      await writeCookbook(COOKBOOK)

      const map = await load()

      expect(map.tickets.map(({ id, name, parent }) => ({ id, name, parent }))).toEqual([
        { id: '01', name: 'Chapter order', parent: null },
        { id: '02', name: 'Printing', parent: null },
        { id: '03', name: 'Index style', parent: '01' },
        { id: '04', name: 'Photos', parent: '01' },
        { id: '05', name: 'Paper stock', parent: '02' },
        { id: '06', name: 'Lighting', parent: '04' },
        { id: '07', name: 'Framing', parent: '04' },
        { id: '08', name: 'Recipe credits', parent: null },
        { id: '09', name: 'Sources', parent: '08' }
      ])
      // The Parent line is metadata, not part of the question.
      expect(map.tickets[2]?.question).toBe('')
    })

    it('never puts a Parent Ticket on the Frontier, and a block on a Ticket blocks everything beneath it', async () => {
      await writeCookbook(COOKBOOK)

      expect(treeOf(await load())).toEqual([
        { id: '01', parent: null, state: 'parent', workable: false, openBlockers: 0, parentWaits: false },
        { id: '02', parent: null, state: 'blocked', workable: false, openBlockers: 1, parentWaits: false },
        { id: '03', parent: '01', state: 'closed', workable: false, openBlockers: 0, parentWaits: false },
        // Its blocker is closed, but it has open Sub-tickets.
        { id: '04', parent: '01', state: 'parent', workable: false, openBlockers: 0, parentWaits: false },
        // Nothing blocks it but its parent's blocker: the parent waits.
        { id: '05', parent: '02', state: 'blocked', workable: false, openBlockers: 0, parentWaits: true },
        { id: '06', parent: '04', state: 'claimed', workable: true, openBlockers: 0, parentWaits: false },
        { id: '07', parent: '04', state: 'frontier', workable: true, openBlockers: 0, parentWaits: false },
        // Every Sub-ticket is closed, so its own question can be answered now.
        { id: '08', parent: null, state: 'frontier', workable: true, openBlockers: 0, parentWaits: false },
        { id: '09', parent: '08', state: 'closed', workable: false, openBlockers: 0, parentWaits: false }
      ])
    })

    it('rolls up every Ticket beneath a Parent Ticket: total, closed, claimed and Frontier', async () => {
      await writeCookbook(COOKBOOK)

      expect(rollupsOf(await load())).toEqual({
        // 03, 04 and, beneath 04, 06 and 07; 04 itself is neither claimed nor on the Frontier.
        '01': { subTickets: 2, total: 4, closed: 1, claimed: 1, frontier: 1 },
        '02': { subTickets: 1, total: 1, closed: 0, claimed: 0, frontier: 0 },
        '04': { subTickets: 2, total: 2, closed: 0, claimed: 1, frontier: 1 }
        // 08's Sub-tickets are all closed: no longer a Parent Ticket, it has no roll-up.
      })
    })

    it('draws edges between the Tickets of one level only', async () => {
      await writeCookbook({ ...COOKBOOK, '10-cover.md': '# Cover\n\nType: prototype\nParent: 08\nBlocked by: 07, 09\n' })

      const map = await load()

      expect(map.liveEdges).toEqual([{ from: '01', to: '02' }])
      // 07 blocks 10 from another level: a block, but no edge.
      expect(map.spentEdges).toEqual([
        { from: '03', to: '04' },
        { from: '09', to: '10' }
      ])
      expect(map.tickets.at(-1)).toMatchObject({ id: '10', state: 'blocked', openBlockers: 1 })
      expect(map.decided).toEqual(['03', '09'])
    })

    it('blocks every Ticket beneath an ancestor with an open blocker, even a closed ancestor', async () => {
      await writeCookbook({
        '01-chapters.md': '# Chapter order\n\nType: grilling\n',
        '02-printing.md': '# Printing\n\nType: task\nStatus: resolved\nBlocked by: 01\n',
        '03-paper.md': '# Paper stock\n\nType: research\nParent: 02\n',
        '04-weight.md': '# Paper weight\n\nType: research\nParent: 03\n'
      })

      expect(treeOf(await load())).toEqual([
        { id: '01', parent: null, state: 'frontier', workable: true, openBlockers: 0, parentWaits: false },
        // Closed wins over its own still-open blocker, which still holds everything beneath it.
        { id: '02', parent: null, state: 'closed', workable: false, openBlockers: 1, parentWaits: false },
        { id: '03', parent: '02', state: 'blocked', workable: false, openBlockers: 0, parentWaits: true },
        { id: '04', parent: '03', state: 'blocked', workable: false, openBlockers: 0, parentWaits: true }
      ])
    })

    it('keeps a Ticket whose Parent line names no Ticket of the Map, or goes round in a circle, at the Map’s level', async () => {
      await writeCookbook({
        '01-chapters.md': '# Chapter order\n\nParent: 42\n',
        '02-printing.md': '# Printing\n\nParent: 03\n',
        '03-paper.md': '# Paper stock\n\nParent: 02\n',
        '04-cover.md': '# Cover\n\nParent: 04\n'
      })

      const { tickets } = await load()

      expect(tickets.map(({ id, parent, state }) => ({ id, parent, state }))).toEqual([
        { id: '01', parent: null, state: 'frontier' },
        { id: '02', parent: null, state: 'frontier' },
        { id: '03', parent: null, state: 'frontier' },
        { id: '04', parent: null, state: 'frontier' }
      ])
    })
  })

  // harbor-api's Map #70 nests sub-issues two levels deep (test/fixtures/gh).
  describe('in a GitHub Map', () => {
    const load = (): Promise<WayfinderMap> => backend.api.map.load(env.projects['harbor-api'], '70')

    it('reads sub-issues of sub-issues, each Ticket after its parent and before its parent’s next sub-issue', async () => {
      const map = await load()

      expect(map.tickets.map(({ id, name, type, parent }) => ({ id, name, type, parent }))).toEqual([
        { id: '71', name: 'Delivery guarantees', type: 'grilling', parent: null },
        { id: '73', name: 'Retry schedule', type: 'research', parent: '71' },
        { id: '74', name: 'Ordering of events', type: 'grilling', parent: '71' },
        { id: '75', name: 'Dead-letter queue', type: 'task', parent: '71' },
        { id: '77', name: 'Replay tool', type: 'prototype', parent: '75' },
        { id: '72', name: 'Signing secrets', type: 'task', parent: null },
        { id: '76', name: 'Secret rotation', type: 'research', parent: '72' }
      ])
      expect(map.tickets[4]?.question).toBe('How does a tenant replay what reached the dead-letter queue?')
    })

    it('derives Parent Tickets, inherited blocks and roll-ups', async () => {
      const map = await load()

      expect(treeOf(map)).toEqual([
        { id: '71', parent: null, state: 'parent', workable: false, openBlockers: 0, parentWaits: false },
        { id: '73', parent: '71', state: 'closed', workable: false, openBlockers: 0, parentWaits: false },
        // Claimed by dana-reyes, not by the signed-in user.
        { id: '74', parent: '71', state: 'claimed', workable: false, openBlockers: 0, parentWaits: false },
        { id: '75', parent: '71', state: 'parent', workable: false, openBlockers: 0, parentWaits: false },
        { id: '77', parent: '75', state: 'frontier', workable: true, openBlockers: 0, parentWaits: false },
        // Natively blocked by 71, a Parent Ticket still open.
        { id: '72', parent: null, state: 'blocked', workable: false, openBlockers: 1, parentWaits: false },
        { id: '76', parent: '72', state: 'blocked', workable: false, openBlockers: 0, parentWaits: true }
      ])
      expect(rollupsOf(map)).toEqual({
        '71': { subTickets: 3, total: 4, closed: 1, claimed: 1, frontier: 1 },
        '75': { subTickets: 1, total: 1, closed: 0, claimed: 0, frontier: 1 },
        '72': { subTickets: 1, total: 1, closed: 0, claimed: 0, frontier: 0 }
      })
      expect(map.liveEdges).toEqual([{ from: '71', to: '72' }])
      expect(map.decided).toEqual(['73'])
    })
  })
})
