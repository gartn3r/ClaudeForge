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
  // No Hosted session yet: an empty tab strip, and the "+" that starts one.
  await expect(window.getByRole('tablist', { name: 'Hosted sessions' })).toBeAttached()
  for (const control of ['New Session', 'Minimize', 'Maximize', 'Close window']) {
    await expect(window.getByRole('button', { name: control, exact: true })).toBeVisible()
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
  await expect(window.getByRole('main', { name: 'Terminal' })).toContainText('Ouvrez un dossier')
  await expect(window.getByRole('complementary', { name: 'Carte' })).toBeVisible()
  await expect(window.getByRole('button', { name: "Replier l'explorateur" })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Fermer la fenêtre' })).toBeVisible()
})

test('sets the interface in the bundled Inter and Fraunces fonts without fetching anything from the network', async () => {
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

  expect(loaded).toContain('Inter')
  expect(loaded).toContain('Fraunces')
  expect(requests.filter((url) => url.endsWith('.woff2')).length).toBeGreaterThan(0)
  expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([])
})

/** Drags a side panel's inner edge by dx pixels. */
async function dragEdge(window: Page, name: string, dx: number): Promise<void> {
  const edge = window.getByRole('separator', { name })
  // Waits until the edge holds still and nothing covers it, as a panel's content can still be loading.
  await edge.hover()
  const box = (await edge.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await window.mouse.move(x, y)
  await window.mouse.down()
  await expect(edge).toHaveAttribute('data-dragging', 'true')
  await window.mouse.move(x + dx / 2, y)
  await window.mouse.move(x + dx, y)
  await window.mouse.up()
}

/** The width the user set for a panel, as its resize edge reports it (the panel gives way in a narrow window). */
const setWidthOf = async (window: Page, resizeName: string): Promise<number> =>
  Number(await window.getByRole('separator', { name: resizeName }).getAttribute('aria-valuenow'))

/** The width a panel takes on screen. */
const widthOf = async (window: Page, name: string): Promise<number> =>
  (await window.getByRole('complementary', { name }).boundingBox())!.width

test('resizes and collapses the side panels, and opens with the same layout after a restart', async () => {
  claudeforge = await launchClaudeForge(env)
  let { window } = claudeforge

  await dragEdge(window, 'Resize the explorer', 100)
  await expect.poll(() => setWidthOf(window, 'Resize the explorer')).toBe(364)

  await dragEdge(window, 'Resize the Map panel', -1000)
  await expect.poll(() => setWidthOf(window, 'Resize the Map panel')).toBe(720)

  await window.getByRole('button', { name: 'Collapse the Map panel' }).click()
  await expect.poll(() => widthOf(window, 'Map')).toBe(64)

  await claudeforge.close()
  claudeforge = await launchClaudeForge(env)
  window = claudeforge.window

  await expect.poll(() => setWidthOf(window, 'Resize the explorer')).toBe(364)
  await expect.poll(() => widthOf(window, 'Map')).toBe(64)

  await window.getByRole('button', { name: 'Expand the Map panel' }).click()
  await expect.poll(() => setWidthOf(window, 'Resize the Map panel')).toBe(720)

  await window.getByRole('button', { name: 'Collapse the explorer' }).click()
  await expect.poll(() => widthOf(window, 'Sessions')).toBe(64)
  await window.getByRole('button', { name: 'Expand the explorer' }).click()
  await expect.poll(() => setWidthOf(window, 'Resize the explorer')).toBe(364)
})

test('keeps both panels and the terminal inside a window at its minimum size', async () => {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  await dragEdge(window, 'Resize the explorer', 1000)
  await dragEdge(window, 'Resize the Map panel', -1000)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 600))

  await expect.poll(() => window.evaluate(() => innerWidth)).toBe(960)
  const terminal = (await window.getByRole('main').boundingBox())!
  const collapseMap = (await window.getByRole('button', { name: 'Collapse the Map panel' }).boundingBox())!
  expect(terminal.width).toBeGreaterThanOrEqual(320)
  expect(collapseMap.x + collapseMap.width).toBeLessThanOrEqual(960)
})
