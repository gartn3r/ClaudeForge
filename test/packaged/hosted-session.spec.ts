// Journeys against a packaged ClaudeForge (CLAUDEFORGE_EXECUTABLE), as `npm run test:packaged` runs
// them: CI installs the installer it just built on a fresh Windows machine first.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, pickFolderInDialogs, type RunningClaudeForge } from '../seam2/claudeforge'

const EXECUTABLE = process.env.CLAUDEFORGE_EXECUTABLE!
/** Where the packaged app keeps node-pty's native module and the ConPTY it ships (ADR 0001). */
const CONPTY = join(dirname(EXECUTABLE), 'resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-x64/conpty')

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

const run = promisify(execFile)

/**
 * The paths of the OpenConsole.exe processes running now. Not from WMI (Get-CimInstance
 * Win32_Process), whose first query on a fresh CI machine can take over a minute, and asked
 * without blocking, so a slow answer counts against the test's timeout instead of stalling it.
 */
async function runningOpenConsoles(): Promise<string[]> {
  const query = 'Get-Process -Name OpenConsole -ErrorAction SilentlyContinue | ForEach-Object Path; exit 0'
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    windowsHide: true,
    timeout: 10_000
  })
  return stdout.split(/\r?\n/).filter(Boolean)
}

test('ships the ConPTY it hosts Sessions in', () => {
  expect(existsSync(join(CONPTY, 'conpty.dll')), 'conpty.dll').toBe(true)
  expect(existsSync(join(CONPTY, 'OpenConsole.exe')), 'OpenConsole.exe').toBe(true)
})

test('starts a Hosted session in its own ConPTY and takes what the user types', async () => {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  // The terminal draws into the page without GPU rendering, where the test can read it.
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('switch', { name: 'GPU rendering' }).click()
  await window.keyboard.press('Escape')
  await pickFolderInDialogs(app, env.projects['harbor-api'])

  await window.getByRole('main', { name: 'Terminal' }).getByRole('button', { name: 'Open folder' }).click()
  const terminal = window.getByRole('main', { name: 'Terminal' })
  await expect(terminal).toContainText('Fake Claude Code')
  await window.keyboard.type('hello')
  await window.keyboard.press('Enter')

  await expect(terminal).toContainText('You wrote: "hello"')
  expect((await runningOpenConsoles()).map((path) => path.toLowerCase())).toContain(join(CONPTY, 'OpenConsole.exe').toLowerCase())
})

test('ships the claudeforge command, which ClaudeForge.exe runs as Node for a Hosted session (ADR 0007)', async () => {
  const cli = join(dirname(EXECUTABLE), 'resources/cli')
  for (const file of ['claudeforge.cmd', 'claudeforge', 'claudeforge.mjs']) expect(existsSync(join(cli, file)), file).toBe(true)
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('switch', { name: 'GPU rendering' }).click()
  await window.keyboard.press('Escape')
  await pickFolderInDialogs(app, env.projects['harbor-api'])
  await window.getByRole('main', { name: 'Terminal' }).getByRole('button', { name: 'Open folder' }).click()
  const terminal = window.getByRole('main', { name: 'Terminal' })
  await expect(terminal).toContainText('Fake Claude Code')

  // As Claude's Bash tool would run it.
  await window.keyboard.type('!claudeforge create panel-tab:tests')
  await window.keyboard.press('Enter')

  await expect(terminal).toContainText('Created panel-tab:tests.')
})
