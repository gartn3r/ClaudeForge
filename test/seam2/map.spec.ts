import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, type RunningClaudeForge } from './claudeforge'

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined

test.beforeEach(async () => {
  env = await createFakeEnvironment()
})

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
})

const boxOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> =>
  (await locator.boundingBox())!

test('shows the Project’s open Map: Destination, Decided strip, open work top to bottom, counts and sections', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })

  await expect(panel.getByRole('heading', { name: 'Meal planner' })).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Destination' })).toContainText(
    'Plan a week of meals from the recipes already in the box.'
  )

  const decided = panel.getByRole('list', { name: 'Decided' })
  await expect(decided.getByRole('listitem')).toHaveText(['Where recipes are stored', 'Nutrition labels'])

  // Open Tickets by name, each with its state, the first rank being those with no open blocker.
  const graph = panel.getByRole('region', { name: 'Open work' })
  const ticket = (name: string): Locator => graph.getByRole('group', { name })
  await expect(ticket('Shape of the week view').getByRole('img', { name: 'Frontier' })).toBeVisible()
  await expect(ticket('Grocery list format').getByRole('img', { name: 'Claimed' })).toBeVisible()
  await expect(ticket('Carry leftovers to the next day').getByRole('img', { name: 'Blocked' })).toBeVisible()
  await expect(ticket('Portion sizes per household').getByRole('img', { name: 'Blocked by 2 open Tickets' })).toBeVisible()
  await expect(graph.getByRole('group', { name: 'Where recipes are stored' })).toHaveCount(0)

  const weekView = await boxOf(ticket('Shape of the week view'))
  const grocery = await boxOf(ticket('Grocery list format'))
  const leftovers = await boxOf(ticket('Carry leftovers to the next day'))
  const portions = await boxOf(ticket('Portion sizes per household'))
  expect(weekView.width).toBe(120)
  expect(grocery.y).toBe(weekView.y)
  expect(leftovers.y).toBeGreaterThan(weekView.y + weekView.height)
  expect(portions.y).toBeGreaterThan(leftovers.y + leftovers.height)

  // Live edges only, after the transitive reduction.
  await expect(graph.getByLabel('Shape of the week view blocks Carry leftovers to the next day')).toHaveCount(1)
  await expect(graph.getByLabel('Carry leftovers to the next day blocks Portion sizes per household')).toHaveCount(1)
  await expect(graph.getByLabel('Shape of the week view blocks Portion sizes per household')).toHaveCount(0)
  await expect(graph.getByLabel('Where recipes are stored blocks Grocery list format')).toHaveCount(0)

  await expect(panel.getByRole('status', { name: 'Counts' })).toHaveText('1 Frontier · 1 claimed · 2 blocked · 2 closed')

  const decisions = panel.getByRole('button', { name: /Decisions so far/ })
  await expect(decisions).toHaveAttribute('aria-expanded', 'false')
  await decisions.click()
  await expect(panel.getByRole('region', { name: 'Decisions so far' })).toContainText(
    'Where recipes are stored: recipes stay in markdown files.'
  )
})

test('draws the spent edges of decided Tickets on demand', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })
  const graph = panel.getByRole('region', { name: 'Open work' })

  await panel.getByRole('button', { name: 'Show their links' }).click()

  await expect(graph.getByRole('group', { name: 'Where recipes are stored' }).getByRole('img', { name: 'Closed' })).toBeVisible()
  await expect(graph.getByLabel('Where recipes are stored blocks Grocery list format')).toHaveCount(1)
  await expect(graph.getByLabel('Shape of the week view blocks Nutrition labels')).toHaveCount(1)

  // The decided Tickets sit above the first rank of open work, which still holds every Ticket with no open blocker.
  const decidedFirst = await boxOf(graph.getByRole('group', { name: 'Where recipes are stored' }))
  const weekView = await boxOf(graph.getByRole('group', { name: 'Shape of the week view' }))
  const grocery = await boxOf(graph.getByRole('group', { name: 'Grocery list format' }))
  expect(grocery.y).toBe(weekView.y)
  expect(decidedFirst.y + decidedFirst.height).toBeLessThan(weekView.y)

  await panel.getByRole('button', { name: 'Hide their links' }).click()
  await expect(graph.getByRole('group', { name: 'Where recipes are stored' })).toHaveCount(0)
})

test('zooms the graph in and out and fits it back to the panel', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })
  const weekView = panel.getByRole('group', { name: 'Shape of the week view' })

  await panel.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => (await boxOf(weekView)).width).toBeGreaterThan(120)

  await panel.getByRole('button', { name: 'Zoom out' }).click()
  await panel.getByRole('button', { name: 'Zoom out' }).click()
  await expect.poll(async () => (await boxOf(weekView)).width).toBeLessThan(120)

  await panel.getByRole('button', { name: 'Fit the Map to the panel' }).click()
  const graph = await boxOf(panel.getByRole('region', { name: 'Open work' }))
  await expect.poll(async () => (await boxOf(weekView)).x).toBeGreaterThanOrEqual(graph.x)
})

test('collapses the Map panel on its own in a Project with no Map', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })
  const { window } = claudeforge

  await expect.poll(async () => (await boxOf(window.getByRole('complementary', { name: 'Map' }))).width).toBe(64)

  await window.getByRole('button', { name: 'Expand the Map panel' }).click()
  await expect(window.getByRole('complementary', { name: 'Map' })).toContainText('No Map in this Project')
})

test('says so when the Project’s Tracker is not supported', async () => {
  await mkdir(join(env.projects.dotfiles, 'docs', 'agents'), { recursive: true })
  await writeFile(join(env.projects.dotfiles, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker: GitLab\n')
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })

  await expect(claudeforge.window.getByRole('complementary', { name: 'Map' })).toContainText(
    'This Project’s Tracker, GitLab, is not supported yet.'
  )
})

test('shows a GitHub Map read through gh: its sub-issues, their blocks and who claimed them', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'harbor-api' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })

  await expect(panel.getByRole('heading', { name: 'Rate limiting' })).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Destination' })).toContainText(
    'Every public endpoint is rate limited per tenant, with limits clients can read.'
  )
  await expect(panel.getByRole('list', { name: 'Decided' }).getByRole('listitem')).toHaveText([
    'Where limits are enforced',
    'Retry-After semantics'
  ])

  const graph = panel.getByRole('region', { name: 'Open work' })
  const ticket = (name: string): Locator => graph.getByRole('group', { name })
  await expect(ticket('Shape of the limit headers').getByRole('img', { name: 'Frontier' })).toBeVisible()
  await expect(ticket('Admin override').getByRole('img', { name: 'Claimed' })).toBeVisible()
  await expect(ticket('Quota dashboard').getByRole('img', { name: 'Blocked by 2 open Tickets' })).toBeVisible()
  await expect(graph.getByLabel('Burst allowance blocks Quota dashboard')).toHaveCount(1)
  await expect(panel.getByRole('status', { name: 'Counts' })).toHaveText('1 Frontier · 2 claimed · 3 blocked · 2 closed')
})

test('says how to sign the GitHub CLI in when it is signed out', async () => {
  await env.dispose()
  env = await createFakeEnvironment({ gh: 'signed-out' })
  claudeforge = await launchClaudeForge(env, { project: 'harbor-api' })

  await expect(claudeforge.window.getByRole('complementary', { name: 'Map' })).toContainText(
    'GitHub CLI is not signed in. Run gh auth login, then refresh.'
  )
})
