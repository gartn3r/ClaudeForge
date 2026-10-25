/// <reference lib="dom" />
// page.evaluate callbacks run in the window, so this file needs the DOM types.
import { expect, test, type Locator, type Page } from '@playwright/test'
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

const terminalOf = (window: Page): Locator => window.getByRole('main', { name: 'Terminal' })

/** Turns GPU rendering off, so the terminal draws its text into the page, where a test can read it. */
async function turnOffGpuRendering(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('switch', { name: 'GPU rendering' }).click()
  await expect(window.getByRole('switch', { name: 'GPU rendering' })).toHaveAttribute('aria-checked', 'false')
  await window.keyboard.press('Escape')
}

/** Starts ClaudeForge and opens a fixture Project with "Open folder", with GPU rendering off. */
async function openFolder(project: 'harbor-api' | 'recipe-box' = 'harbor-api'): Promise<Page> {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  await turnOffGpuRendering(window)
  await pickFolderInDialogs(app, env.projects[project])
  await window.getByRole('button', { name: 'Open folder' }).click()
  await expect(terminalOf(window)).toContainText('Fake Claude Code')
  return window
}

test('opens a folder, runs Claude Code there and takes what the user types', async () => {
  const window = await openFolder('harbor-api')

  await window.keyboard.type('hello')
  await window.keyboard.press('Enter')

  await expect(terminalOf(window)).toContainText('You wrote: "hello"')
  const runs = await sessionRuns(env)
  expect(runs.map(({ args, cwd }) => ({ args, cwd }))).toEqual([
    { args: ['--session-id', expect.any(String)], cwd: env.projects['harbor-api'] }
  ])
})

test('inserts a newline in the prompt on Shift+Enter, and sends it on Enter', async () => {
  const window = await openFolder()

  await window.keyboard.type('first line')
  await window.keyboard.press('Shift+Enter')
  await window.keyboard.type('second line')
  await window.keyboard.press('Enter')

  await expect(terminalOf(window)).toContainText(String.raw`You wrote: "first line\nsecond line"`)
})

/** The terminal size the fake `claude` last reported, as it saw it in its terminal. */
async function reportedSize(window: Page): Promise<{ cols: number; rows: number }> {
  const text = (await terminalOf(window).textContent()) ?? ''
  const [, cols, rows] = [...text.matchAll(/Terminal (?:resized to )?(\d+)x(\d+)/g)].at(-1) ?? []
  return { cols: Number(cols), rows: Number(rows) }
}

test('resizes Claude Code to fit when the panels or the window change size', async () => {
  const window = await openFolder()
  const { app } = claudeforge!
  const started = await reportedSize(window)

  await window.getByRole('button', { name: 'Collapse the explorer' }).click()
  await expect.poll(async () => (await reportedSize(window)).cols).toBeGreaterThan(started.cols)
  const widened = await reportedSize(window)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 600))
  await expect.poll(async () => (await reportedSize(window)).rows).toBeLessThan(widened.rows)
  expect((await reportedSize(window)).cols).toBeLessThan(widened.cols)
})

test('draws the terminal with WebGL where the machine has it, and with the DOM renderer once GPU rendering is off', async () => {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  const terminal = terminalOf(window)
  // WebGL draws the cells on a canvas; the DOM renderer writes them into the page as text.
  const cellsOnCanvas = terminal.locator('canvas')
  await pickFolderInDialogs(app, env.projects['harbor-api'])
  await window.getByRole('button', { name: 'Open folder' }).click()
  await expect.poll(async () => (await sessionRuns(env)).length).toBe(1)

  const hasWebgl = await window.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null)
  if (hasWebgl) {
    await expect(cellsOnCanvas).not.toHaveCount(0)
    await expect(terminal).not.toContainText('Fake Claude Code')
  } else {
    await expect(terminal).toContainText('Fake Claude Code')
  }

  await turnOffGpuRendering(window)

  await expect(cellsOnCanvas).toHaveCount(0)
  await expect(terminal).toContainText('Fake Claude Code')
})

test("sets the terminal in the design system's mono-terminal type, on the terminal well", async () => {
  const window = await openFolder()
  const text = terminalOf(window).getByText('Fake Claude Code')

  await expect(text).toHaveCSS('font-family', /^"JetBrains Mono"/)
  await expect(text).toHaveCSS('font-size', '13px')
  // The text token on the terminal-well token.
  await expect(text).toHaveCSS('color', 'rgb(223, 230, 238)')
  const background = await text.evaluate((element) => {
    // The first background painted behind the text.
    for (let at: Element | null = element; at; at = at.parentElement) {
      const color = getComputedStyle(at).backgroundColor
      if (color !== 'rgba(0, 0, 0, 0)') return color
    }
    return null
  })
  expect(background).toBe('rgb(11, 16, 22)')
})
