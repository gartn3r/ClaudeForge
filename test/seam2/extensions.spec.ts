import { expect, test, type Locator, type Page } from '@playwright/test'
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

const extensionsBar = (window: Page): Locator =>
  window.getByRole('complementary', { name: 'Sessions' }).getByRole('button', { name: /^Extensions/ })

/** The rows of one group of the open Extensions menu. */
const group = (menu: Locator, name: string): Locator => menu.getByRole('list', { name }).getByRole('listitem')

test('the Extensions bar counts the displayed Project’s Extensions, and its menu lists them by scope with origin and MCP status', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const bar = extensionsBar(claudeforge.window)

  // Everything a new Session in recipe-box gets, global and the Project's own; failing MCP servers flagged.
  await expect(bar).toHaveAccessibleName('Extensions: 5 skills, 4 subagents, 5 MCP servers (2 failing), 3 plugins')
  await expect(bar).toHaveText(/Extensions\s*5\s*4\s*5\s*3/)

  await bar.click()
  const menu = claudeforge.window.getByRole('dialog', { name: 'Extensions' })
  const scope = menu.getByRole('group', { name: 'Scope' })

  await expect(bar).toHaveAttribute('aria-expanded', 'true')
  await expect(scope.getByRole('button', { name: 'This Project · recipe-box' })).toHaveAttribute('aria-pressed', 'true')
  await expect(group(menu, 'MCP servers')).toHaveText([/^playwright\s*Failed to connect\s*Project/, /^postgres\s*Project/])
  await expect(group(menu, 'MCP servers').first().getByRole('img', { name: 'Failed' })).toBeVisible()
  await expect(group(menu, 'MCP servers').last().getByRole('img', { name: 'Connected' })).toBeVisible()
  await expect(group(menu, 'Skills')).toHaveText([/^seed-data\s*Project/, /^ui-polish\s*frontend-design/])
  await expect(group(menu, 'Subagents')).toHaveText([/^migration-reviewer\s*Project/])
  await expect(group(menu, 'Plugins')).toHaveText([/^frontend-design\s*Project/])

  await scope.getByRole('button', { name: 'Global' }).click()

  await expect(scope.getByRole('button', { name: 'Global' })).toHaveAttribute('aria-pressed', 'true')
  await expect(group(menu, 'MCP servers')).toHaveText([
    /^claude\.ai Supabase\s*Sign in with \/mcp in a Session\s*Global/,
    /^github\s*Global/,
    /^pantry\s*kitchen-tools/
  ])
  await expect(group(menu, 'MCP servers').first().getByRole('img', { name: 'Needs sign-in' })).toBeVisible()
  await expect(group(menu, 'Skills')).toHaveText([
    /^menu-copy\s*kitchen-tools/,
    /^plating\s*kitchen-tools/,
    /^release-notes\s*Global/
  ])
  await expect(group(menu, 'Subagents')).toHaveText([
    /^code-reviewer\s*Global/,
    /^line-cook\s*kitchen-tools/,
    /^sous-chef\s*kitchen-tools/
  ])
  await expect(group(menu, 'Plugins')).toHaveText([/^atlas\s*Disabled\s*Global/, /^kitchen-tools\s*Global/])
  // Read-only: nothing to switch on or off.
  await expect(menu.getByRole('switch')).toHaveCount(0)

  await claudeforge.window.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(bar).toBeFocused()
})

test('This Project follows the displayed Session', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const window = claudeforge.window
  const bar = extensionsBar(window)
  await expect(bar).toHaveAccessibleName(/^Extensions: 5 skills/)

  await window
    .getByRole('complementary', { name: 'Sessions' })
    .getByRole('list', { name: 'harbor-api' })
    .getByRole('listitem')
    .filter({ hasText: 'Paginate the audit log endpoint with cursors' })
    .click()

  await expect(bar).toHaveAccessibleName('Extensions: 3 skills, 3 subagents, 6 MCP servers (2 failing), 2 plugins')
  await bar.click()
  const menu = window.getByRole('dialog', { name: 'Extensions' })
  await expect(menu.getByRole('button', { name: 'This Project · harbor-api' })).toHaveAttribute('aria-pressed', 'true')
  // harbor-api's own github replaces the user's.
  await expect(group(menu, 'MCP servers')).toHaveText([
    /^github\s*Project/,
    /^metrics\s*Warming up\s*Project/,
    /^sentry\s*Project/,
    /^tracing\s*Connected · tools fetch failed\s*Project/
  ])
  await expect(group(menu, 'MCP servers').nth(2).getByRole('img', { name: 'Pending approval' })).toBeVisible()
  await expect(menu.getByRole('list', { name: 'Skills' })).toHaveCount(0)
})
