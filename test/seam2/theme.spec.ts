import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
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

const themeOn = (window: Page): Promise<string | undefined> => window.evaluate(() => document.documentElement.dataset.theme)

test('follows Windows until the user picks a Theme in the settings, which lasts across a restart', async () => {
  claudeforge = await launchClaudeForge(env, { colorScheme: 'dark' })
  let { window } = claudeforge
  await expect.poll(() => themeOn(window)).toBe('dark')
  // Bento · Nuit: never black, the ground a warm dark grey.
  await expect(window.locator('.shell')).toHaveCSS('background-color', 'rgb(38, 40, 45)')

  await window.getByRole('button', { name: 'Settings' }).click()
  const themes = window.getByRole('group', { name: 'Theme' })
  await expect(themes.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
  await themes.getByRole('button', { name: 'Light' }).click()
  await expect.poll(() => themeOn(window)).toBe('light')
  await expect(window.locator('.shell')).toHaveCSS('background-color', 'rgb(245, 241, 227)')

  await claudeforge.close()
  claudeforge = await launchClaudeForge(env, { colorScheme: 'dark' })
  window = claudeforge.window
  await expect.poll(() => themeOn(window)).toBe('light')
})

test("the window's colour fills the ground between the tiles, the Right panel's the card behind its Panel tabs, in every Theme", async () => {
  await writeFile(
    join(env.userDataDir, 'elements.json'),
    JSON.stringify({
      version: 1,
      own: { window: { backgroundColor: '#dcdcf3' }, 'right-panel': { backgroundColor: '#f3d6c6' } },
      projects: {}
    })
  )
  claudeforge = await launchClaudeForge(env, { colorScheme: 'dark' })
  const { window } = claudeforge

  await expect(window.locator('.shell')).toHaveCSS('background-color', 'rgb(220, 220, 243)')
  await expect(window.locator('.titlebar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const rightPanel = window.getByRole('complementary', { name: 'Map' })
  await expect(rightPanel).toHaveCSS('background-color', 'rgb(243, 214, 198)')
  await expect(rightPanel.locator('.side-panel__body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})
