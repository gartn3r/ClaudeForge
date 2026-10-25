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

const RECIPE_BOX_COUNTS = '4 skills, 3 subagents, 5 MCP servers (2 failing), 3 plugins'

const extensionsBar = (window: Page): Locator =>
  window.getByRole('complementary', { name: 'Sessions' }).getByRole('button', { name: /^Extensions/ })

/** The rows of one group of the open Extensions menu, as text. */
const group = (menu: Locator, name: string): Locator => menu.getByRole('list', { name }).getByRole('listitem')

test('the Extensions bar counts what a new Session in the displayed Project gets, flagging failing MCP servers', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const bar = extensionsBar(claudeforge.window)

  await expect(bar).toHaveAccessibleName(`Extensions: ${RECIPE_BOX_COUNTS}`)
  await expect(bar).toHaveText(/Extensions\s*4\s*3\s*5\s*3/)
  await expect(bar.getByTitle('5 MCP servers (2 failing)')).toHaveClass(/extbar__count--failing/)
  await expect(bar.getByTitle('4 skills')).not.toHaveClass(/extbar__count--failing/)
})

test('the Extensions menu lists this Project’s Extensions, then the global ones, with origin and MCP status', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const bar = extensionsBar(claudeforge.window)
  await bar.click()
  const menu = claudeforge.window.getByRole('dialog', { name: 'Extensions' })
  const scope = menu.getByRole('group', { name: 'Scope' })

  await expect(bar).toHaveAttribute('aria-expanded', 'true')
  await expect(scope.getByRole('button', { name: 'This Project · recipe-box' })).toHaveAttribute('aria-pressed', 'true')
  await expect(group(menu, 'MCP servers')).toHaveText([
    /^playwright\s*Failed to connect\s*Project/,
    /^postgres\s*Project/
  ])
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
  await expect(group(menu, 'Skills')).toHaveText([/^menu-copy\s*kitchen-tools/, /^release-notes\s*Global/])
  await expect(group(menu, 'Subagents')).toHaveText([/^code-reviewer\s*Global/, /^sous-chef\s*kitchen-tools/])
  await expect(group(menu, 'Plugins')).toHaveText([/^atlas\s*Disabled\s*Global/, /^kitchen-tools\s*Global/])
  // Read-only: nothing to switch, edit or add.
  await expect(menu.getByRole('switch')).toHaveCount(0)

  await claudeforge.window.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(bar).toBeFocused()
})

test('This Project follows the displayed Session', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const window = claudeforge.window
  const bar = extensionsBar(window)
  await expect(bar).toHaveAccessibleName(`Extensions: ${RECIPE_BOX_COUNTS}`)

  await window
    .getByRole('complementary', { name: 'Sessions' })
    .getByRole('list', { name: 'harbor-api' })
    .getByRole('listitem')
    .filter({ hasText: 'Paginate the audit log endpoint with cursors' })
    .click()

  await expect(bar).toHaveAccessibleName('Extensions: 2 skills, 2 subagents, 5 MCP servers (2 failing), 2 plugins')
  await bar.click()
  const menu = window.getByRole('dialog', { name: 'Extensions' })
  await expect(menu.getByRole('button', { name: 'This Project · harbor-api' })).toHaveAttribute('aria-pressed', 'true')
  await expect(group(menu, 'MCP servers')).toHaveText([
    /^sentry\s*Project/,
    /^tracing\s*Connected · tools fetch failed\s*Project/
  ])
  await expect(group(menu, 'MCP servers').first().getByRole('img', { name: 'Pending approval' })).toBeVisible()
  await expect(menu.getByRole('list', { name: 'Skills' })).toHaveCount(0)
})

test('a Project with no Extensions of its own says so', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })
  await extensionsBar(claudeforge.window).click()
  const menu = claudeforge.window.getByRole('dialog', { name: 'Extensions' })

  await expect(menu.getByText('dotfiles has no Extensions of its own.')).toBeVisible()
  await expect(menu.getByRole('list')).toHaveCount(0)
})
