import { expect, test, type Locator } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, type RunningClaudeForge } from './claudeforge'

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined

/** A Session in recipe-box that invoked `/wayfinder` with these arguments, under Claude Code's name for it. */
async function wayfinderSession(id: string, args: string, title: string, timestamp: string): Promise<void> {
  const cwd = env.projects['recipe-box']
  await env.writeHistory(cwd, id, [
    {
      type: 'user',
      cwd,
      timestamp,
      message: {
        role: 'user',
        content: `<command-message>wayfinder</command-message>\n<command-name>/wayfinder</command-name>\n<command-args>${args}</command-args>`
      }
    },
    { type: 'ai-title', aiTitle: title }
  ])
}

test.beforeEach(async () => {
  env = await createFakeEnvironment()
  await wayfinderSession('6d7e8f90-a1b2-4c3d-94e5-f6a7b8c9d0e1', 'pantry-audit', 'Audit the pantry', '2026-10-21T09:00:00.000Z')
  await wayfinderSession('7e8f90a1-b2c3-4d4e-a5f6-a7b8c9d0e1f2', 'meal-planner 04', 'Grocery list export', '2026-10-21T10:00:00.000Z')
})

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
})

test('the Map panel follows the displayed Session, its Ticket highlighted and other Sessions’ Tickets badged', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const { window } = claudeforge
  const explorer = window.getByRole('complementary', { name: 'Sessions' })
  const panel = window.getByRole('complementary', { name: 'Map' })
  const row = (title: string): Locator =>
    explorer.getByRole('list', { name: 'recipe-box' }).getByRole('listitem').filter({ hasText: title })
  const ticket = (name: string): Locator => panel.getByRole('region', { name: 'Open work' }).getByRole('group', { name })

  // Each Session names what it works on.
  await expect(row('/wayfinder meal-planner 02')).toContainText('Ticket · Shape of the week view')
  await expect(row('Audit the pantry')).toContainText('Map · Pantry audit')
  await expect(row('Chart the meal planner')).not.toContainText('·')

  // No Session displayed yet: the Project's most recent open Map.
  await expect(panel.getByRole('heading', { name: 'Meal planner' })).toBeVisible()

  await row('Audit the pantry').click()
  await expect(row('Audit the pantry')).toHaveAttribute('aria-current', 'true')
  await expect(panel.getByRole('heading', { name: 'Pantry audit' })).toBeVisible()

  await row('/wayfinder meal-planner 02').click()
  await expect(panel.getByRole('heading', { name: 'Meal planner' })).toBeVisible()
  await expect(ticket('Shape of the week view')).toHaveAttribute('aria-current', 'true')
  await expect(ticket('Grocery list format')).not.toHaveAttribute('aria-current', 'true')

  // The badge of the Session working another Ticket switches to it.
  await ticket('Grocery list format').getByRole('button', { name: 'Grocery list export' }).click()
  await expect(row('Grocery list export')).toHaveAttribute('aria-current', 'true')
  await expect(row('/wayfinder meal-planner 02')).not.toHaveAttribute('aria-current', 'true')
  await expect(ticket('Grocery list format')).toHaveAttribute('aria-current', 'true')
  await expect(ticket('Shape of the week view').getByRole('button', { name: '/wayfinder meal-planner 02' })).toBeVisible()

  // A Session of another Project brings that Project's Map panel.
  await explorer.getByRole('list', { name: 'harbor-api' }).getByRole('listitem').filter({ hasText: 'Add an OpenAPI export' }).click()
  await expect(panel).toContainText('This Project’s Tracker, GitHub, is not supported yet.')
})

test('the Map selector shows another Map of the Project until another Session is displayed', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const { window } = claudeforge
  const panel = window.getByRole('complementary', { name: 'Map' })

  await panel.getByRole('button', { name: 'Meal planner' }).click()
  const maps = panel.getByRole('menu', { name: 'Maps' })
  await expect(maps.getByRole('menuitemradio')).toHaveCount(2)
  await expect(maps.getByRole('menuitemradio', { name: /Pantry audit/ })).toHaveAttribute('aria-checked', 'false')
  await expect(maps.getByRole('menuitemradio', { name: /Meal planner/ })).toHaveAttribute('aria-checked', 'true')

  await maps.getByRole('menuitemradio', { name: /Pantry audit/ }).click()
  await expect(maps).toHaveCount(0)
  await expect(panel.getByRole('heading', { name: 'Pantry audit' })).toBeVisible()

  await window
    .getByRole('complementary', { name: 'Sessions' })
    .getByRole('list', { name: 'recipe-box' })
    .getByRole('listitem')
    .filter({ hasText: '/wayfinder meal-planner 02' })
    .click()
  await expect(panel.getByRole('heading', { name: 'Meal planner' })).toBeVisible()
})
