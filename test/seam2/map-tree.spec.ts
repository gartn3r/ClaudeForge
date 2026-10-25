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

// harbor-api's Map #70 Webhooks nests Sub-tickets two levels deep (test/fixtures/gh).
test('switches to the Tree view, hides closed Tickets, then opens a Parent Ticket in the graph', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'harbor-api' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })
  const chooseMap = async (shown: string, name: RegExp): Promise<void> => {
    await panel.getByRole('heading', { name: shown }).getByRole('button').click()
    await panel.getByRole('menu', { name: 'Maps' }).getByRole('menuitemradio', { name }).click()
  }
  await chooseMap('Rate limiting', /Webhooks/)

  const views = panel.getByRole('group', { name: 'View' })
  await expect(views.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-pressed', 'true')
  await views.getByRole('button', { name: 'Tree' }).click()

  // The whole hierarchy at once: roll-ups on Parent Tickets, the Frontier, why each blocked Ticket waits.
  const tree = panel.getByRole('tree', { name: 'Tickets' })
  const row = (name: string): Locator => tree.getByRole('treeitem', { name, exact: true })
  await expect(panel.getByRole('region', { name: 'Open work' })).toHaveCount(0)
  await expect(tree.getByRole('treeitem')).toHaveText([
    /^Delivery guarantees.*1\/4$/,
    /^Retry schedule$/,
    /^Ordering of events.*dana-reyes$/,
    /^Dead-letter queue.*0\/1$/,
    /^Replay tool.*Frontier$/,
    /^Signing secrets.*after Delivery guarantees$/,
    /^Secret rotation.*parent waits$/
  ])
  await expect(row('Replay tool')).toHaveAttribute('aria-level', '3')
  await expect(row('Retry schedule').getByRole('img', { name: 'Closed' })).toBeVisible()
  await expect(row('Signing secrets').getByRole('img', { name: 'Blocked' })).toBeVisible()
  await expect(row('Secret rotation').getByRole('img', { name: 'Blocked: its Parent Ticket waits' })).toBeVisible()
  await expect(panel.getByRole('status', { name: 'Counts' })).toHaveText('1 Frontier · 1 claimed · 1/7 closed')

  const hideClosed = panel.getByRole('switch', { name: 'Hide closed Tickets' })
  await hideClosed.click()
  await expect(hideClosed).toHaveAttribute('aria-checked', 'true')
  await expect(row('Retry schedule')).toHaveCount(0)

  // The twisty only folds.
  const twisty = row('Dead-letter queue').getByRole('button', { name: 'Sub-tickets of Dead-letter queue' })
  await twisty.click()
  await expect(twisty).toHaveAttribute('aria-expanded', 'false')
  await expect(row('Replay tool')).toHaveCount(0)
  await expect(tree).toBeVisible()

  // The view, hidden closed Tickets and folded rows are the Map's own.
  await chooseMap('Webhooks', /Rate limiting/)
  await expect(views.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('region', { name: 'Open work' })).toBeVisible()
  await chooseMap('Rate limiting', /Webhooks/)
  await expect(row('Dead-letter queue')).toBeVisible()
  await expect(row('Replay tool')).toHaveCount(0)
  await expect(row('Retry schedule')).toHaveCount(0)

  // A Parent Ticket's name opens it in the graph.
  await row('Delivery guarantees').getByRole('button', { name: 'Delivery guarantees', exact: true }).click()
  await expect(views.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('navigation', { name: 'Where you are in the Map' }).locator('[aria-current="page"]')).toHaveText(
    'Delivery guarantees'
  )
  await expect(panel.getByRole('region', { name: 'Open work' }).getByRole('group', { name: 'Ordering of events' })).toBeVisible()
})
