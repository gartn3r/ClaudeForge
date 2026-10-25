import { readdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

describe('Map service', () => {
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

  /** Sets the modification time of one file of a recipe-box effort, or of all its files. */
  const touch = async (effort: string, date: string, file?: string): Promise<void> => {
    const folder = join(env.projects['recipe-box'], '.scratch', effort)
    const files = file ? [file] : ['map.md', ...(await readdir(join(folder, 'issues'))).map((name) => `issues/${name}`)]
    for (const path of files) await utimes(join(folder, path), new Date(date), new Date(date))
  }

  describe('Tracker detection', () => {
    it('reads a local markdown Tracker from the issue-tracker declaration', async () => {
      const listing = await backend.api.map.list(env.projects['recipe-box'])

      expect(listing.tracker).toEqual({ kind: 'local-markdown' })
    })

    it('falls back to local markdown when the Project declares no Tracker', async () => {
      const listing = await backend.api.map.list(env.projects.dotfiles)

      expect(listing).toEqual({ tracker: { kind: 'local-markdown' }, maps: [] })
    })

    it('reports any other declared Tracker as unsupported, naming it', async () => {
      const listing = await backend.api.map.list(env.projects['harbor-api'])

      expect(listing).toEqual({ tracker: { kind: 'unsupported', name: 'GitHub' }, maps: [] })
    })
  })

  describe('listing Maps', () => {
    it('lists every effort folder holding a map.md, most recently updated first', async () => {
      await touch('meal-planner', '2026-10-01T10:00:00Z')
      await touch('meal-planner', '2026-10-03T10:00:00Z', 'issues/04-grocery-list.md')
      await touch('pantry-audit', '2026-10-02T10:00:00Z')

      const { maps } = await backend.api.map.list(env.projects['recipe-box'])

      expect(maps).toEqual([
        {
          id: 'meal-planner',
          name: 'Meal planner',
          path: join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'map.md'),
          updatedAt: Date.parse('2026-10-03T10:00:00Z'),
          open: true
        },
        expect.objectContaining({ id: 'pantry-audit', name: 'Pantry audit', open: false })
      ])
    })

    it('counts an edit to map.md as an update of its Map', async () => {
      await touch('meal-planner', '2026-10-03T10:00:00Z')
      await touch('pantry-audit', '2026-10-01T10:00:00Z')
      await touch('pantry-audit', '2026-10-05T10:00:00Z', 'map.md')

      const { maps } = await backend.api.map.list(env.projects['recipe-box'])

      expect(maps.map((map) => map.id)).toEqual(['pantry-audit', 'meal-planner'])
    })
  })

  describe('loading a local markdown Map', () => {
    const load = (): ReturnType<Backend['api']['map']['load']> =>
      backend.api.map.load(env.projects['recipe-box'], 'meal-planner')

    it('reads the Destination and the sections of map.md, without template comments', async () => {
      const map = await load()

      expect(map).toMatchObject({
        id: 'meal-planner',
        name: 'Meal planner',
        destination: 'Plan a week of meals from the recipes already in the box.',
        notes: "Recipes are the household's own; keep everything offline.",
        decisionsSoFar:
          '- [Where recipes are stored](issues/01-recipe-storage.md): recipes stay in markdown files.\n' +
          '- [Nutrition labels](issues/06-nutrition-labels.md): no nutrition data for now.',
        notYetSpecified: '- **Seasonal menus**: whether the planner suggests by season.\n- How leftovers carry over.',
        outOfScope: '- Shopping delivery.'
      })
    })

    it('reads each numbered Ticket file: name, Type, Status, Blocked by, question and answer', async () => {
      const { tickets } = await load()

      expect(tickets.map(({ id, name, type, open, claimed, blockedBy }) => ({ id, name, type, open, claimed, blockedBy }))).toEqual([
        { id: '01', name: 'Where recipes are stored', type: 'grilling', open: false, claimed: false, blockedBy: [] },
        { id: '02', name: 'Shape of the week view', type: 'prototype', open: true, claimed: false, blockedBy: [] },
        { id: '03', name: 'Carry leftovers to the next day', type: 'research', open: true, claimed: false, blockedBy: ['02'] },
        { id: '04', name: 'Grocery list format', type: 'task', open: true, claimed: true, blockedBy: ['01'] },
        { id: '05', name: 'Portion sizes per household', type: 'grilling', open: true, claimed: false, blockedBy: ['02', '03'] },
        { id: '06', name: 'Nutrition labels', type: 'research', open: false, claimed: false, blockedBy: ['02'] }
      ])
      expect(tickets[0]).toMatchObject({
        path: join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'issues', '01-recipe-storage.md'),
        question: 'Where do recipes live: markdown files, a database, or a spreadsheet?',
        answer: 'Recipes stay in markdown files.',
        assignee: null
      })
    })

    it('derives each Ticket state in precedence order: closed, blocked, claimed, Frontier', async () => {
      const { tickets } = await load()

      expect(tickets.map(({ id, state, workable, openBlockers }) => ({ id, state, workable, openBlockers }))).toEqual([
        { id: '01', state: 'closed', workable: false, openBlockers: 0 },
        { id: '02', state: 'frontier', workable: true, openBlockers: 0 },
        { id: '03', state: 'blocked', workable: false, openBlockers: 1 },
        // Claimed with a closed blocker; a local markdown claim is always the current user's.
        { id: '04', state: 'claimed', workable: true, openBlockers: 0 },
        { id: '05', state: 'blocked', workable: false, openBlockers: 2 },
        // Closed wins over its still-open blocker.
        { id: '06', state: 'closed', workable: false, openBlockers: 1 }
      ])
    })

    it('puts the closed Tickets, in Map order, in the Decided set', async () => {
      expect((await load()).decided).toEqual(['01', '06'])
    })

    it('draws live edges only between open Tickets, dropping those implied by a longer path', async () => {
      // 02 blocks 03 and 05, 03 blocks 05: the edge from 02 to 05 is implied.
      expect((await load()).liveEdges).toEqual([
        { from: '02', to: '03' },
        { from: '03', to: '05' }
      ])
    })

    it('keeps the edges touching a closed Ticket as spent edges, drawn on demand', async () => {
      expect((await load()).spentEdges).toEqual([
        { from: '01', to: '04' },
        { from: '02', to: '06' }
      ])
    })

    it('reduces a longer chain to its steps, whatever order the files list them in', async () => {
      const issues = join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'issues')
      await writeFile(join(issues, '07-menu-card.md'), '# Menu card\n\nType: prototype\nBlocked by: 05, 02, 03\n')
      await writeFile(join(issues, '08-print.md'), '# Printing\n\nType: task\nBlocked by: 07, 02\n')

      const { liveEdges, tickets } = await load()

      expect(liveEdges).toEqual([
        { from: '02', to: '03' },
        { from: '03', to: '05' },
        { from: '05', to: '07' },
        { from: '07', to: '08' }
      ])
      expect(tickets.find((ticket) => ticket.id === '07')?.openBlockers).toBe(3)
    })

    it('keeps Tickets in number order past 99', async () => {
      const issues = join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'issues')
      await writeFile(join(issues, '100-dessert.md'), '# Desserts\n\nType: grilling\n')
      await writeFile(join(issues, '99-snacks.md'), '# Snacks\n\nType: grilling\n')

      const { tickets } = await load()

      expect(tickets.slice(-2).map((ticket) => ticket.name)).toEqual(['Snacks', 'Desserts'])
    })

    it('ignores a Blocked by reference to a Ticket the Map does not have', async () => {
      const file = join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'issues', '07-seasonal.md')
      await writeFile(file, '# Seasonal menus\n\nType: grilling\nBlocked by: 2, 42\n')

      const { tickets } = await load()

      expect(tickets.at(-1)).toMatchObject({ id: '07', blockedBy: ['02', '42'], state: 'blocked', openBlockers: 1 })
    })

    it('refuses a Map id that is not an effort folder of the Project', async () => {
      await expect(backend.api.map.load(env.projects['recipe-box'], 'ideas')).rejects.toThrow()
      await expect(backend.api.map.load(env.projects['recipe-box'], '../recipe-box/.scratch/meal-planner')).rejects.toThrow()
    })
  })
})
