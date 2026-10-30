import { expect, test, type Locator } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, pickFolderInDialogs, sessionRuns, type RunningClaudeForge } from './claudeforge'

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

test('opens another folder while a Session runs, from the Sessions card or its rail, each Session Hosted in its own tab', async () => {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  const explorer = window.getByRole('complementary', { name: 'Sessions' })
  const tabs = window.getByRole('tablist', { name: 'Hosted sessions' }).getByRole('tab')
  const hostedIn = (project: string): Locator =>
    explorer.getByRole('group', { name: project }).getByRole('treeitem').filter({ has: window.getByRole('img', { name: 'Running in ClaudeForge' }) })

  await pickFolderInDialogs(app, env.projects['harbor-api'])
  await window.getByRole('main', { name: 'Terminal' }).getByRole('button', { name: 'Open folder' }).click()
  await expect(tabs).toHaveCount(1)
  await expect(window.getByRole('main', { name: 'Terminal' }).getByRole('button', { name: 'Open folder' })).toBeHidden()

  // A Session runs: the Sessions card still opens a folder, and a new one at that.
  await pickFolderInDialogs(app, env.projects.dotfiles)
  await explorer.getByRole('button', { name: 'Open folder' }).click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')

  // Each is listed as Hosted, not as open elsewhere, and a click on one brings its tab back.
  await expect(hostedIn('harbor-api')).toHaveCount(1)
  await expect(hostedIn('dotfiles')).toHaveCount(1)
  await expect(hostedIn('harbor-api')).not.toContainText('Open elsewhere')
  await expect(hostedIn('dotfiles')).not.toContainText('Open elsewhere')
  await hostedIn('harbor-api').click()
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

  // Collapsed, the explorer's rail opens a folder too; a folder already listed gets a new Session.
  await window.getByRole('button', { name: 'Collapse the explorer' }).click()
  await pickFolderInDialogs(app, env.projects['harbor-api'])
  await explorer.getByRole('button', { name: 'Open folder' }).click()
  await expect(tabs).toHaveCount(3)

  await expect
    .poll(async () => (await sessionRuns(env)).map(({ cwd }) => cwd))
    .toEqual([env.projects['harbor-api'], env.projects.dotfiles, env.projects['harbor-api']])
})
