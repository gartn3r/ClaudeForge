import { expect, test, type Page } from '@playwright/test'
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

/** Starts ClaudeForge in recipe-box; GPU rendering, which a first launch turns off, stays off after a restart. */
async function launch({ turnGpuOff = false } = {}): Promise<Page> {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const { window } = claudeforge
  if (turnGpuOff) {
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('switch', { name: 'GPU rendering' }).click()
    await expect(window.getByRole('switch', { name: 'GPU rendering' })).toHaveAttribute('aria-checked', 'false')
    await window.keyboard.press('Escape')
  }
  return window
}

test('closing while a Session works warns, naming it; reopening brings it back as a dormant tab that resumes once clicked', async () => {
  let window = await launch({ turnGpuOff: true })
  await window.getByRole('button', { name: 'New Session', exact: true }).click()
  await expect(window.getByRole('tabpanel')).toContainText('Fake Claude Code')
  await window.keyboard.type('/work 60000')
  await window.keyboard.press('Enter')
  const tab = window.getByRole('tab', { name: '/work 60000' })
  await expect(tab).toHaveAccessibleDescription('Working')
  // Claude Code keeps the Session's history from its first prompt, so the explorer lists it.
  await expect(
    window
      .getByRole('complementary', { name: 'Sessions' })
      .getByRole('list', { name: 'recipe-box' })
      .getByRole('listitem')
      .filter({ hasText: '/work 60000' })
  ).toBeVisible()
  const { args } = (await sessionRuns(env))[0]!
  const sessionId = args[args.indexOf('--session-id') + 1]!

  // Windows asks to close the window, as for Alt+F4: ClaudeForge warns first, and the user changes their mind.
  const { app } = claudeforge!
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  const warning = window.getByRole('alertdialog', { name: 'Claude is still working in a Session. Close ClaudeForge?' })
  await expect(warning.getByRole('listitem')).toHaveText(['/work 60000'])
  await warning.getByRole('button', { name: 'Cancel' }).click()
  await expect(warning).toBeHidden()
  await expect(tab).toHaveAccessibleDescription('Working')

  // The title bar's close button warns too; closing anyway stops claude and closes ClaudeForge.
  const closed = app.waitForEvent('close')
  await window.getByRole('button', { name: 'Close window' }).click()
  await warning.getByRole('button', { name: 'Close anyway' }).click()
  await closed
  claudeforge = undefined

  window = await launch()
  const dormant = window.getByRole('tab', { name: '/work 60000' })
  await expect(dormant).toHaveAccessibleDescription('Not started')
  await expect(window.getByRole('main', { name: 'Terminal' })).toContainText('Select a tab to resume its Session.')
  expect(await sessionRuns(env)).toHaveLength(1)

  await dormant.click()

  await expect(window.getByRole('tabpanel')).toContainText('Fake Claude Code')
  expect((await sessionRuns(env)).slice(1)).toEqual([
    expect.objectContaining({ args: ['--resume', sessionId], cwd: env.projects['recipe-box'] })
  ])
  await expect(dormant).toHaveAccessibleDescription('Ready')
})
