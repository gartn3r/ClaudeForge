import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
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

/** The `claude mcp …` and `claude plugin …` commands that changed something. */
const changes = async (): Promise<string[]> =>
  (await env.invocations('claude'))
    .filter(({ args }) => ['mcp', 'plugin'].includes(args[0]!) && args[1] !== 'list')
    .map(({ args }) => args.join(' '))

/** Starts ClaudeForge in recipe-box and opens the Extensions menu at a scope. */
async function openMenu(scope: 'Global' | 'This Project · recipe-box' = 'This Project · recipe-box'): Promise<Locator> {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const bar = claudeforge.window.getByRole('complementary', { name: 'Sessions' }).getByRole('button', { name: /^Extensions/ })
  await expect(bar).toHaveAccessibleName(/^Extensions: 5 skills/)
  await bar.click()
  const menu = claudeforge.window.getByRole('dialog', { name: 'Extensions' })
  await menu.getByRole('group', { name: 'Scope' }).getByRole('button', { name: scope }).click()
  return menu
}

const row = (menu: Locator, group: string, name: string): Locator =>
  menu.getByRole('list', { name: group }).getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) })

/** Starts a Session with the title bar's "+", names it by sending a prompt, and waits for its tab. */
async function startSession(window: Page, prompt: string): Promise<void> {
  const runs = (await sessionRuns(env)).length
  await window.getByRole('button', { name: 'New Session', exact: true }).click()
  await expect.poll(async () => (await sessionRuns(env)).length).toBe(runs + 1)
  await window.keyboard.type(prompt)
  await window.keyboard.press('Enter')
  await expect(window.getByRole('tab', { name: prompt })).toBeVisible()
}

test('a plugin’s toggle disables it through `claude plugin disable`, waiting while the command runs', async () => {
  const menu = await openMenu('Global')
  const toggle = menu.getByRole('switch', { name: 'Enable kitchen-tools' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('switch', { name: 'Enable atlas' })).toHaveAttribute('aria-checked', 'false')
  const release = await env.holdClaudeChanges()

  await toggle.click()

  // Every toggle waits while Claude Code changes the setup.
  await expect.poll(changes).toEqual(['plugin disable kitchen-tools@forge-market -s user'])
  await expect(toggle).toBeDisabled()
  await expect(menu.getByRole('switch', { name: 'Enable atlas' })).toBeDisabled()
  // The menu stays until the change is through, to show how it went.
  await claudeforge!.window.keyboard.press('Escape')
  await expect(menu).toBeVisible()

  await release()

  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(row(menu, 'Plugins', 'kitchen-tools')).toContainText('Disabled')
  // What the plugin brought is gone with it.
  await expect(row(menu, 'Skills', 'menu-copy')).toHaveCount(0)
  await expect(menu.getByRole('status')).toHaveText('Applies to new Sessions.')
})

test('a change Claude Code refuses shows its words and leaves the toggle as it was', async () => {
  const menu = await openMenu('This Project · recipe-box')
  await env.failClaudeChanges('Settings file .claude/settings.local.json is read-only')
  const toggle = menu.getByRole('switch', { name: 'Enable frontend-design' })

  await toggle.click()

  await expect(menu.getByRole('alert')).toHaveText(/Settings file \.claude\/settings\.local\.json is read-only/)
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(await changes()).toEqual(['plugin disable frontend-design@forge-market -s project'])
})

test('removing an MCP server asks first, then runs `claude mcp remove`', async () => {
  const menu = await openMenu('This Project · recipe-box')
  const window = claudeforge!.window

  await row(menu, 'MCP servers', 'playwright').getByRole('button', { name: 'Remove playwright' }).click()
  const confirm = window.getByRole('alertdialog', { name: 'Remove playwright?' })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  // It may be the Project's shared server.
  await expect(confirm).toContainText('If the Project shares this server in its .mcp.json')
  await confirm.getByRole('button', { name: 'Cancel' }).click()

  await expect(confirm).toBeHidden()
  await expect(menu).toBeVisible()
  expect(await changes()).toEqual([])

  await row(menu, 'MCP servers', 'playwright').getByRole('button', { name: 'Remove playwright' }).click()
  await confirm.getByRole('button', { name: 'Remove' }).click()

  await expect(confirm).toBeHidden()
  await expect(row(menu, 'MCP servers', 'playwright')).toHaveCount(0)
  expect(await changes()).toEqual(['mcp remove playwright -s local'])
  // A plugin's server and a claude.ai connector are not Claude Code's to remove.
  await menu.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'Global' }).click()
  await expect(row(menu, 'MCP servers', 'github').getByRole('button', { name: 'Remove github' })).toBeVisible()
  await expect(row(menu, 'MCP servers', 'pantry').getByRole('button')).toHaveCount(0)
  await expect(row(menu, 'MCP servers', 'claude.ai Supabase').getByRole('button')).toHaveCount(0)
})

test('uninstalling a plugin asks first, then runs `claude plugin uninstall`', async () => {
  const menu = await openMenu('Global')

  await row(menu, 'Plugins', 'atlas').getByRole('button', { name: 'Uninstall atlas' }).click()
  await claudeforge!.window.getByRole('alertdialog', { name: 'Uninstall atlas?' }).getByRole('button', { name: 'Uninstall' }).click()

  await expect(row(menu, 'Plugins', 'atlas')).toHaveCount(0)
  expect(await changes()).toEqual(['plugin uninstall atlas@forge-market -s user'])
})

test('adds an MCP server for the Project through `claude mcp add`', async () => {
  const menu = await openMenu('This Project · recipe-box')
  const window = claudeforge!.window

  await menu.getByRole('button', { name: 'Add MCP server' }).click()
  const dialog = window.getByRole('dialog', { name: 'Add an MCP server to recipe-box' })
  await dialog.getByLabel('Name').fill('notes')
  await dialog.getByLabel('Command').fill('npx -y "notes mcp"')
  await dialog.getByLabel('Environment variables').fill('NOTES_DIR=C:\\Notes\nLOG=1')
  await dialog.getByRole('button', { name: 'Add' }).click()

  await expect(dialog).toBeHidden()
  await expect(row(menu, 'MCP servers', 'notes')).toContainText('Project')
  expect(await changes()).toEqual(['mcp add -s local -t stdio notes -e NOTES_DIR=C:\\Notes -e LOG=1 -- npx -y notes mcp'])
  const [add] = (await env.invocations('claude')).filter(({ args }) => args[1] === 'add')
  expect(add!.args.slice(-3)).toEqual(['npx', '-y', 'notes mcp'])
})

test('adds a remote MCP server for the user, with headers', async () => {
  const menu = await openMenu('Global')
  const window = claudeforge!.window

  await menu.getByRole('button', { name: 'Add MCP server' }).click()
  const dialog = window.getByRole('dialog', { name: 'Add a global MCP server' })
  await dialog.getByLabel('Transport').selectOption('http')
  await dialog.getByLabel('Name').fill('wiki')
  await dialog.getByLabel('URL').fill('https://wiki.example/mcp')
  await dialog.getByLabel('Headers').fill('Authorization: Bearer abc')
  await dialog.getByRole('button', { name: 'Add' }).click()

  await expect(row(menu, 'MCP servers', 'wiki')).toContainText('Global')
  expect(await changes()).toEqual(['mcp add -s user -t http wiki https://wiki.example/mcp -H Authorization: Bearer abc'])
})

test('a server Claude Code will not add keeps the dialog open with its words', async () => {
  const menu = await openMenu('Global')
  const window = claudeforge!.window

  await menu.getByRole('button', { name: 'Add MCP server' }).click()
  const dialog = window.getByRole('dialog', { name: 'Add a global MCP server' })
  await dialog.getByLabel('Name').fill('github')
  await dialog.getByLabel('Command').fill('npx')
  await dialog.getByRole('button', { name: 'Add' }).click()

  await expect(dialog.getByRole('alert')).toHaveText('MCP server github already exists in user config')
  await expect(dialog).toBeVisible()
})

test('installs a marketplace plugin for the Project through `claude plugin install`', async () => {
  const menu = await openMenu('This Project · recipe-box')
  const window = claudeforge!.window

  await menu.getByRole('button', { name: 'Install plugin' }).click()
  const dialog = window.getByRole('dialog', { name: 'Install a plugin in recipe-box' })
  const offered = dialog.getByRole('list', { name: 'Plugins' }).getByRole('listitem')
  await expect(offered).toHaveText([/^pastry-kit\s*forge-market/, /^sentry-tools\s*ops-market/])
  await dialog.getByLabel('Search').fill('baking')
  await expect(offered).toHaveText([/^pastry-kit/])
  await offered.getByRole('button', { name: 'Install pastry-kit' }).click()

  await expect(dialog).toBeHidden()
  await expect(row(menu, 'Plugins', 'pastry-kit')).toContainText('Project')
  await expect(row(menu, 'Skills', 'proofing')).toContainText('pastry-kit')
  expect(await changes()).toEqual(['plugin install pastry-kit@forge-market -s local'])
})

test('a failed install keeps the plugin dialog open with Claude Code’s words', async () => {
  const menu = await openMenu('Global')
  const window = claudeforge!.window

  await menu.getByRole('button', { name: 'Install plugin' }).click()
  const dialog = window.getByRole('dialog', { name: 'Install a global plugin' })
  await dialog.getByRole('button', { name: 'Install sentry-tools' }).click()

  await expect(dialog.getByRole('alert')).toHaveText(/could not reach https:\/\/git\.ops\.example\/plugins\.git/)
  await expect(dialog.getByRole('button', { name: 'Install sentry-tools' })).toBeEnabled()
})

test('after a change, the notice lists the open Sessions still using the previous setup', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const window = claudeforge.window
  await startSession(window, 'before the change')
  await startSession(window, 'also before')
  const bar = window.getByRole('complementary', { name: 'Sessions' }).getByRole('button', { name: /^Extensions/ })
  await bar.click()
  const menu = window.getByRole('dialog', { name: 'Extensions' })
  await menu.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'Global' }).click()

  await menu.getByRole('switch', { name: 'Enable atlas' }).click()

  const notice = menu.getByRole('status')
  await expect(notice).toContainText('Applies to new Sessions. 2 open Sessions still use the previous setup.')
  await expect(notice.getByRole('button')).toHaveText(['before the change', 'also before'])

  // A Session started afterwards has the new setup.
  await window.keyboard.press('Escape')
  await startSession(window, 'after the change')
  await window.getByRole('tab', { name: 'also before' }).getByRole('button', { name: 'Close' }).click()
  await bar.click()
  await expect(notice).toContainText('1 open Session still uses the previous setup.')
  await notice.getByRole('button', { name: 'before the change' }).click()

  await expect(window.getByRole('tab', { name: 'before the change' })).toHaveAttribute('aria-selected', 'true')
})
