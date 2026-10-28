import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment, type FixtureProject } from '../fake-env'
import { launchClaudeForge, sessionRuns, type RunningClaudeForge } from './claudeforge'

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

/** harbor-api's "Add an OpenAPI export", a past Session. */
const PAST_SESSION = '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11'

/** Starts ClaudeForge in recipe-box with GPU rendering off, so a test can read the terminal. */
async function launch(): Promise<Page> {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const { window } = claudeforge
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('switch', { name: 'GPU rendering' }).click()
  await expect(window.getByRole('switch', { name: 'GPU rendering' })).toHaveAttribute('aria-checked', 'false')
  await window.keyboard.press('Escape')
  return window
}

const row = (window: Page, project: FixtureProject, title: string): Locator =>
  window
    .getByRole('complementary', { name: 'Sessions' })
    .getByRole('group', { name: project })
    .getByRole('treeitem')
    .filter({ hasText: title })

test('resumes a past Session of another Project in a new tab, and that Project becomes the active one', async () => {
  const window = await launch()
  const mapPanel = window.getByRole('complementary', { name: 'Map' })
  await expect(mapPanel.getByRole('heading', { name: 'Meal planner' })).toBeVisible()

  await row(window, 'harbor-api', 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menu').getByRole('menuitem', { name: 'Resume' }).click()

  await expect(window.getByRole('tablist', { name: 'Hosted sessions' }).getByRole('tab')).toHaveCount(1)
  await expect(window.getByRole('tabpanel')).toContainText('Fake Claude Code')
  expect(await sessionRuns(env)).toEqual([
    expect.objectContaining({ args: ['--resume', PAST_SESSION], cwd: env.projects['harbor-api'] })
  ])
  await expect(mapPanel.getByRole('heading', { name: 'Rate limiting' })).toBeVisible()
})

test('starts a new Session in a Project with its "+", forks a past Session, and offers neither to a running External session', async () => {
  const window = await launch()

  await window.getByRole('button', { name: 'New Session in harbor-api' }).click()
  await expect.poll(() => sessionRuns(env)).toEqual([
    expect.objectContaining({ args: ['--session-id', expect.any(String)], cwd: env.projects['harbor-api'] })
  ])

  await row(window, 'harbor-api', 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Fork' }).click()
  await expect
    .poll(async () => (await sessionRuns(env)).slice(1))
    .toEqual([
      expect.objectContaining({
        args: ['--resume', PAST_SESSION, '--fork-session', '--session-id', expect.any(String)],
        cwd: env.projects['harbor-api']
      })
    ])
  await expect(window.getByRole('tablist', { name: 'Hosted sessions' }).getByRole('tab')).toHaveCount(2)

  await row(window, 'harbor-api', 'Rate limiter rewrite').click({ button: 'right' })
  await expect(window.getByRole('menuitem', { name: 'Resume' })).toBeDisabled()
  await expect(window.getByRole('menuitem', { name: 'Fork' })).toBeDisabled()
})
