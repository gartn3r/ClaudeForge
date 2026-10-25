import { expect, test } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment, type FakeEnvironmentOptions } from '../fake-env'
import { launchClaudeForge, type RunningClaudeForge } from './claudeforge'

let env: FakeEnvironment | undefined
let claudeforge: RunningClaudeForge | undefined

const launchOn = async (options: FakeEnvironmentOptions): Promise<RunningClaudeForge> => {
  env = await createFakeEnvironment(options)
  claudeforge = await launchClaudeForge(env)
  return claudeforge
}

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env?.dispose()
  env = undefined
})

test('explains that Claude Code is missing, and opens the shell once Check again finds it', async () => {
  const { window } = await launchOn({ claude: false })

  const firstRun = window.getByRole('main', { name: 'Claude Code was not found' })
  await expect(firstRun).toBeVisible()
  await expect(firstRun).toContainText('PATH')
  await expect(firstRun.getByRole('link', { name: 'installation guide' })).toBeVisible()
  await expect(window.getByRole('main', { name: 'Terminal' })).toHaveCount(0)

  await firstRun.getByRole('button', { name: 'Check again' }).click()
  await expect(firstRun).toBeVisible()

  await env!.installClaude()
  await firstRun.getByRole('button', { name: 'Check again' }).click()

  await expect(window.getByRole('main', { name: 'Terminal' })).toBeVisible()
  await expect(window.getByRole('complementary', { name: 'Sessions' })).toBeVisible()
})

test('opens the installation guide in the default browser', async () => {
  const { app, window } = await launchOn({ claude: false })
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url) => void opened.push(url)
  })

  await window.getByRole('link', { name: 'installation guide' }).click()

  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['https://code.claude.com/docs/en/setup'])
  await expect(window.getByRole('main', { name: 'Claude Code was not found' })).toBeVisible()
})

test('remembers the claude.exe the user chooses, and opens on the shell after a restart', async () => {
  const { app, window } = await launchOn({ claude: { location: 'elsewhere' } })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, env!.claudePath!)

  await window.getByRole('button', { name: 'Choose claude.exe…' }).click()
  await expect(window.getByRole('main', { name: 'Terminal' })).toBeVisible()

  await claudeforge!.close()
  claudeforge = await launchClaudeForge(env!)
  await expect(claudeforge.window.getByRole('main', { name: 'Terminal' })).toBeVisible()
})

test('tells the user the minimum supported version when their Claude Code is too old, and how to update', async () => {
  const { window } = await launchOn({ claude: { version: '1.0.44' } })

  const firstRun = window.getByRole('main', { name: 'Claude Code 1.0.44 is too old' })
  await expect(firstRun).toBeVisible()
  await expect(firstRun).toContainText('ClaudeForge needs Claude Code 2.1.0 or later')
  await expect(firstRun).toContainText('claude update')
  await expect(firstRun.getByRole('button', { name: 'Check again' })).toBeVisible()
})
