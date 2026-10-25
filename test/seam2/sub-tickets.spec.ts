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
test('opens a Parent Ticket level by level, then goes back by the breadcrumb and the back button', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'harbor-api' })
  const panel = claudeforge.window.getByRole('complementary', { name: 'Map' })
  await panel.getByRole('button', { name: 'Rate limiting' }).click()
  await panel.getByRole('menu', { name: 'Maps' }).getByRole('menuitemradio', { name: /Webhooks/ }).click()

  const graph = panel.getByRole('region', { name: 'Open work' })
  const ticket = (name: string): Locator => graph.getByRole('group', { name })
  const crumbs = panel.getByRole('navigation', { name: 'Where you are in the Map' })
  const counts = panel.getByRole('status', { name: 'Counts' })

  // At the Map's level, Parent Tickets are stacks with the roll-up of everything beneath them.
  await expect(ticket('Delivery guarantees')).toContainText('3 sub')
  await expect(ticket('Delivery guarantees')).toContainText('1 Frontier · 1/4 closed')
  await expect(ticket('Signing secrets').getByRole('img', { name: 'Blocked' })).toBeVisible()
  await expect(ticket('Signing secrets')).toContainText('Waits for Delivery guarantees')
  await expect(graph.getByRole('group', { name: 'Ordering of events' })).toHaveCount(0)
  await expect(counts).toHaveText('1 Frontier · 1 claimed · 2 blocked · 1 closed')
  await expect(crumbs).toHaveCount(0)

  await ticket('Delivery guarantees').getByRole('button', { name: 'Open Delivery guarantees' }).click()

  // Its question in place of the Destination, its Sub-tickets in the graph, its decided ones above.
  await expect(panel.getByRole('region', { name: 'Destination' })).toHaveCount(0)
  await expect(panel.getByRole('region', { name: 'Question' })).toContainText('How sure can a tenant be that a webhook arrives?')
  await expect(crumbs.getByRole('button', { name: 'Webhooks' })).toBeVisible()
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Delivery guarantees')
  await expect(panel.getByRole('list', { name: 'Decided' }).getByRole('listitem')).toHaveText(['Retry schedule'])
  await expect(ticket('Ordering of events').getByRole('img', { name: 'Claimed' })).toBeVisible()
  await expect(ticket('Dead-letter queue')).toContainText('1 Frontier · 0/1 closed')
  await expect(graph.getByRole('group', { name: 'Signing secrets' })).toHaveCount(0)
  await expect(counts).toHaveText('1 Frontier · 1 claimed · 0 blocked · 1 closed')

  await ticket('Dead-letter queue').getByRole('button', { name: 'Open Dead-letter queue' }).click()
  await expect(ticket('Replay tool').getByRole('img', { name: 'Frontier' })).toBeVisible()
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Dead-letter queue')

  await crumbs.getByRole('button', { name: 'Delivery guarantees' }).click()
  await expect(ticket('Ordering of events')).toBeVisible()
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Delivery guarantees')

  await panel.getByRole('button', { name: 'Back to Webhooks' }).click()
  await expect(crumbs).toHaveCount(0)
  await expect(panel.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Destination' })).toContainText(
    'Tenants hear about every limit they reach through signed webhooks.'
  )

  // A block on a Parent Ticket blocks everything beneath it.
  await ticket('Signing secrets').getByRole('button', { name: 'Open Signing secrets' }).click()
  await expect(ticket('Secret rotation').getByRole('img', { name: 'Blocked: its Parent Ticket waits' })).toBeVisible()
})
