/// <reference lib="dom" />
// page.evaluate callbacks run in the window, so this file needs the DOM types.
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

test('opens on the title bar and the three columns, with the Extensions bar under the explorer', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge

  await expect(window.getByRole('banner')).toContainText('ClaudeForge')
  await expect(window.getByRole('tablist', { name: 'Hosted sessions' })).toBeVisible()
  for (const control of ['Minimize', 'Maximize', 'Close window']) {
    await expect(window.getByRole('button', { name: control })).toBeVisible()
  }

  const explorer = window.getByRole('complementary', { name: 'Sessions' })
  await expect(explorer).toBeVisible()
  await expect(explorer.getByRole('region', { name: 'Extensions' })).toBeVisible()
  await expect(window.getByRole('main', { name: 'Terminal' })).toBeVisible()
  await expect(window.getByRole('complementary', { name: 'Map' })).toBeVisible()

  const [explorerBox, terminalBox, mapBox] = await Promise.all([
    explorer.boundingBox(),
    window.getByRole('main').boundingBox(),
    window.getByRole('complementary', { name: 'Map' }).boundingBox()
  ])
  expect(explorerBox!.width).toBe(264)
  expect(mapBox!.width).toBe(400)
  expect(explorerBox!.x).toBeLessThan(terminalBox!.x)
  expect(terminalBox!.x).toBeLessThan(mapBox!.x)
})

test('speaks French when Windows is displayed in French', async () => {
  await env.dispose()
  env = await createFakeEnvironment({ systemLanguages: ['fr-FR', 'en-US'] })
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge

  await expect(window.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(window.getByRole('main', { name: 'Terminal' })).toContainText('Démarrez une Session')
  await expect(window.getByRole('complementary', { name: 'Carte' })).toBeVisible()
  await expect(window.getByRole('button', { name: "Replier l'explorateur" })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Fermer la fenêtre' })).toBeVisible()
})

test('sets the interface in the bundled Geist font without fetching anything from the network', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge
  const requests: string[] = []
  window.on('request', (request) => requests.push(request.url()))
  await window.reload()
  await window.getByRole('main').waitFor()

  const loaded = await window.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family)
  })

  expect(loaded).toContain('Geist')
  expect(requests.filter((url) => url.endsWith('.woff2')).length).toBeGreaterThan(0)
  expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([])
})

/** Drags a side panel's inner edge by dx pixels. */
async function dragEdge(window: Page, name: string, dx: number): Promise<void> {
  const box = (await window.getByRole('separator', { name }).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await window.mouse.move(x, y)
  await window.mouse.down()
  await window.mouse.move(x + dx / 2, y)
  await window.mouse.move(x + dx, y)
  await window.mouse.up()
}

const widthOf = async (window: Page, name: string): Promise<number> =>
  (await window.getByRole('complementary', { name }).boundingBox())!.width

test('resizes and collapses the side panels, and opens with the same layout after a restart', async () => {
  claudeforge = await launchClaudeForge(env)
  let { window } = claudeforge

  await dragEdge(window, 'Resize the explorer', 100)
  await expect.poll(() => widthOf(window, 'Sessions')).toBe(364)

  await dragEdge(window, 'Resize the Map panel', -1000)
  await expect.poll(() => widthOf(window, 'Map')).toBe(720)

  await window.getByRole('button', { name: 'Collapse the Map panel' }).click()
  await expect.poll(() => widthOf(window, 'Map')).toBe(40)

  await claudeforge.close()
  claudeforge = await launchClaudeForge(env)
  window = claudeforge.window

  await expect.poll(() => widthOf(window, 'Sessions')).toBe(364)
  await expect.poll(() => widthOf(window, 'Map')).toBe(40)

  await window.getByRole('button', { name: 'Expand the Map panel' }).click()
  await expect.poll(() => widthOf(window, 'Map')).toBe(720)

  await window.getByRole('button', { name: 'Collapse the explorer' }).click()
  await expect.poll(() => widthOf(window, 'Sessions')).toBe(40)
  await window.getByRole('button', { name: 'Expand the explorer' }).click()
  await expect.poll(() => widthOf(window, 'Sessions')).toBe(364)
})
