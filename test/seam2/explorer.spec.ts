import { rm } from 'node:fs/promises'
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

const OPEN_ELSEWHERE = 'Open elsewhere. It can be resumed here once it ends.'

test('lists every Session by Project, newest first, with worktrees folded and External sessions marked', async () => {
  claudeforge = await launchClaudeForge(env)
  const explorer = claudeforge.window.getByRole('complementary', { name: 'Sessions' })
  const sessionsOf = (project: string): Locator => explorer.getByRole('group', { name: project }).getByRole('treeitem')

  await expect(explorer.getByRole('heading')).toHaveText(['harbor-api', 'recipe-box'])
  await expect(sessionsOf('harbor-api')).toHaveText([
    /^Rate limiter rewrite\s*Open elsewhere/,
    /^Paginate the audit log endpoint with cursors/,
    /^Add an OpenAPI export/
  ])
  await expect(sessionsOf('recipe-box')).toHaveText([
    /^Chart the meal planner/,
    /^\/wayfinder meal-planner 02\s*Ticket · Shape of the week view\s*week-view/,
    /^Track leftovers in the fridge.*leftovers/
  ])

  const external = sessionsOf('harbor-api').first()
  // It can be picked, not displayed: out of the Tab order.
  await expect(external).toHaveAttribute('tabindex', '-1')
  await expect(external).toHaveAttribute('title', new RegExp(`^${OPEN_ELSEWHERE}\\n9c1e4b2a-6d3f-4e8b-8a17-3b5d2e9f0c42`))

  // Ids stay out of the rows, in the tooltip.
  const past = sessionsOf('harbor-api').last()
  await expect(past).not.toContainText('5b0c7f0e')
  await expect(past).toHaveAttribute('title', /5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11/)
  await expect(past).toHaveAttribute('tabindex', '0')
})

test('updates the explorer by itself when a Session starts and when an External session ends', async () => {
  // On the list as its `claude` starts in ClaudeForge, before it writes any history.
  await env.listSessions('3a4b5c6d-7e8f-4091-a2b3-c4d5e6f7a8b9')
  claudeforge = await launchClaudeForge(env)
  const explorer = claudeforge.window.getByRole('complementary', { name: 'Sessions' })
  await expect(explorer.getByRole('heading')).toHaveText(['harbor-api', 'recipe-box'])

  await env.writeHistory(env.projects.dotfiles, '3a4b5c6d-7e8f-4091-a2b3-c4d5e6f7a8b9', [
    { type: 'user', cwd: env.projects.dotfiles, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Sync my dotfiles' } }
  ])

  await expect(explorer.getByRole('heading')).toHaveText(['dotfiles', 'harbor-api', 'recipe-box'])
  await expect(explorer.getByRole('group', { name: 'dotfiles' })).toHaveText(/Sync my dotfiles/)

  // The External session's claude exits, removing its registry entry.
  await rm(env.liveSessions['harbor-api/rate-limiter']!)

  const rateLimiter = explorer.getByRole('group', { name: 'harbor-api' }).getByRole('treeitem').first()
  await expect(rateLimiter).toHaveAttribute('tabindex', '0')
  await expect(rateLimiter).not.toContainText('Open elsewhere')
})
