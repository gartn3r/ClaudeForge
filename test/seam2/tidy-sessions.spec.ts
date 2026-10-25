import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, encodeProjectPath, type FakeEnvironment } from '../fake-env'
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

const explorerOf = (window: Page): Locator => window.getByRole('complementary', { name: 'Sessions' })
const harborSessions = (window: Page): Locator =>
  explorerOf(window).getByRole('list', { name: 'harbor-api' }).getByRole('listitem')
const row = (window: Page, title: string): Locator => harborSessions(window).filter({ hasText: title })

test('renames a Session from its menu, and Escape leaves the name as it was', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menu').getByRole('menuitem', { name: 'Rename' }).click()
  const name = explorerOf(window).getByRole('textbox', { name: 'Session name' })
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('Add an OpenAPI export')
  await name.fill('OpenAPI, for the partners')
  await name.press('Enter')

  await expect(harborSessions(window).last()).toHaveText(/^OpenAPI, for the partners/)

  await row(window, 'OpenAPI, for the partners').hover()
  await row(window, 'OpenAPI, for the partners').getByRole('button', { name: 'Session actions' }).click()
  await window.getByRole('menuitem', { name: 'Rename' }).click()
  await name.fill('Something else')
  await name.press('Escape')

  await expect(name).toBeHidden()
  await expect(harborSessions(window).last()).toHaveText(/^OpenAPI, for the partners/)
})

test('hides a Session, shows hidden Sessions again on demand, and unhides one', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge
  const showHidden = explorerOf(window).getByRole('switch', { name: 'Show hidden' })
  await expect(showHidden).toBeHidden()

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Hide' }).click()

  await expect(harborSessions(window)).toHaveCount(2)
  await expect(row(window, 'Add an OpenAPI export')).toHaveCount(0)

  await showHidden.click()
  await expect(showHidden).toHaveAttribute('aria-checked', 'true')
  await expect(harborSessions(window)).toHaveCount(3)
  const hidden = row(window, 'Add an OpenAPI export')
  await expect(hidden).toHaveAttribute('data-hidden', 'true')

  await hidden.click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Unhide' }).click()

  await expect(showHidden).toBeHidden()
  await expect(row(window, 'Add an OpenAPI export')).not.toHaveAttribute('data-hidden')
  await expect(harborSessions(window)).toHaveCount(3)
})

test('moves a past Session to the Recycle Bin after a confirmation, never an External one', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge
  const dialog = window.getByRole('alertdialog', { name: 'Move this Session to the Recycle Bin?' })

  await row(window, 'Rate limiter rewrite').click({ button: 'right' })
  await expect(window.getByRole('menuitem', { name: 'Move to Recycle Bin' })).toBeDisabled()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('menu')).toBeHidden()

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Move to Recycle Bin' }).click()
  await expect(dialog).toContainText('"Add an OpenAPI export" and its history leave ClaudeForge and Claude Code.')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await window.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(harborSessions(window)).toHaveCount(3)

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Move to Recycle Bin' }).click()
  await dialog.getByRole('button', { name: 'Move to Recycle Bin' }).click()

  await expect(dialog).toBeHidden()
  await expect(row(window, 'Add an OpenAPI export')).toHaveCount(0)
  await expect(harborSessions(window)).toHaveCount(2)
  expect(await env.recycled()).toEqual([
    join(env.claudeHome, 'projects', encodeProjectPath(env.projects['harbor-api']), '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11.jsonl')
  ])
})
