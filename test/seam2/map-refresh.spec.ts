import { readFile, writeFile } from 'node:fs/promises'
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

/** How a Ticket of the graph moves and animates, as the window draws it. */
const motionOf = (ticket: Locator): Promise<{ transition: string; animation: string }> =>
  ticket.evaluate((node) => ({
    transition: getComputedStyle(node).transitionDuration,
    animation: getComputedStyle(node.querySelector('.cf-ticket')!).animationName
  }))

/** Rewrites a meal-planner Ticket file as Wayfinder would. */
async function editTicket(file: string, edit: (text: string) => string): Promise<void> {
  const path = join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'issues', file)
  await writeFile(path, edit(await readFile(path, 'utf8')))
}

test('a local markdown Map change animates into the graph as soon as its files change', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })
  const graph = panel.getByRole('region', { name: 'Open work' })
  const ticket = (name: string): Locator => graph.getByRole('group', { name })
  await expect(ticket('Carry leftovers to the next day').getByRole('img', { name: 'Blocked' })).toBeVisible()
  // Relayouts glide; nothing is animating while the Map stays as it is.
  expect(await motionOf(ticket('Carry leftovers to the next day'))).toEqual({ transition: '0.32s', animation: 'none' })

  // Claude settles the week view and charts a new Ticket.
  await editTicket('02-week-view.md', (text) => text.replace('Status: open', 'Status: resolved'))
  await writeFile(
    join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'issues', '07-shopping-budget.md'),
    '# Shopping budget\n\nType: research\nStatus: open\nBlocked by: 04\n'
  )

  // The closed Ticket leaves the graph for the Decided strip, sliding up into it.
  const decided = panel.getByRole('list', { name: 'Decided' })
  await expect(decided.getByRole('listitem')).toHaveText(['Where recipes are stored', 'Shape of the week view', 'Nutrition labels'])
  await expect(ticket('Shape of the week view')).toHaveCount(0)
  await expect(decided.getByRole('listitem').nth(1)).toHaveCSS('animation-name', 'map-decided-in')
  // The Ticket it blocked joins the Frontier and pulses once.
  await expect(ticket('Carry leftovers to the next day').getByRole('img', { name: 'Frontier' })).toBeVisible()
  expect((await motionOf(ticket('Carry leftovers to the next day'))).animation).toBe('map-frontier-pulse')
  // The new Ticket fades in.
  await expect(ticket('Shopping budget').getByRole('img', { name: 'Blocked' })).toBeVisible()
  expect((await motionOf(ticket('Shopping budget'))).animation).toBe('map-ticket-in')
  await expect(panel.getByRole('status', { name: 'Counts' })).toHaveText('1 Frontier · 1 claimed · 2 blocked · 3 closed')
})

test('under reduced motion, a Map change shows at once', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  await claudeforge.window.emulateMedia({ reducedMotion: 'reduce' })
  const graph = claudeforge.window.getByRole('complementary', { name: 'Map' }).getByRole('region', { name: 'Open work' })
  const ticket = (name: string): Locator => graph.getByRole('group', { name })
  await expect(ticket('Carry leftovers to the next day')).toBeVisible()

  await editTicket('02-week-view.md', (text) => text.replace('Status: open', 'Status: resolved'))

  await expect(ticket('Carry leftovers to the next day').getByRole('img', { name: 'Frontier' })).toBeVisible()
  expect(await motionOf(ticket('Carry leftovers to the next day'))).toEqual({ transition: '0s', animation: 'none' })
})

test('the refresh button reads a GitHub Map again and tells when it last did', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'harbor-api' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })
  const graph = panel.getByRole('region', { name: 'Open work' })
  await expect(panel.getByRole('heading', { name: 'Rate limiting' })).toBeVisible()
  await expect(graph.getByRole('group', { name: 'Shape of the limit headers' })).toBeVisible()
  const refresh = panel.getByRole('button', { name: 'Refresh the Map' })
  await expect(refresh).toHaveAttribute('title', /^Refresh the Map\nLast refreshed at \d{1,2}:\d{2}/)

  // Someone closes the Ticket on GitHub.
  const file = join(env.ghRecordings, 'api', 'repos', 'fixture', 'harbor-api', 'issues', '40', 'sub_issues.json')
  const issues = JSON.parse(await readFile(file, 'utf8')) as Array<{ number: number; state: string }>
  for (const issue of issues) if (issue.number === 42) issue.state = 'closed'
  await writeFile(file, JSON.stringify(issues))
  await refresh.click()

  await expect(graph.getByRole('group', { name: 'Shape of the limit headers' })).toHaveCount(0)
  await expect(panel.getByRole('list', { name: 'Decided' }).getByRole('listitem')).toContainText(['Shape of the limit headers'])
  await expect(graph.getByRole('group', { name: 'Burst allowance' }).getByRole('img', { name: 'Frontier' })).toBeVisible()
})
