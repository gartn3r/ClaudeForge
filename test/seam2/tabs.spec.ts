/// <reference lib="dom" />
// page.evaluate callbacks run in the window, so this file needs the DOM types.
import { execFileSync } from 'node:child_process'
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

/** The terminal on show: only the active tab's terminal is in the accessibility tree. */
const shownTerminal = (window: Page): Locator => window.getByRole('tabpanel')

/** Starts ClaudeForge in harbor-api, with GPU rendering off unless asked, so a test can read the terminal. */
async function launch({ gpuRendering = false } = {}): Promise<Page> {
  claudeforge = await launchClaudeForge(env, { project: 'harbor-api' })
  const { window } = claudeforge
  if (!gpuRendering) {
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('switch', { name: 'GPU rendering' }).click()
    await expect(window.getByRole('switch', { name: 'GPU rendering' })).toHaveAttribute('aria-checked', 'false')
    await window.keyboard.press('Escape')
  }
  return window
}

/** Starts a Session with the title bar's "+" and waits for the fake `claude` to start in it. */
async function newSession(window: Page): Promise<void> {
  const runs = (await sessionRuns(env)).length
  await window.getByRole('button', { name: 'New Session', exact: true }).click()
  await expect.poll(async () => (await sessionRuns(env)).length).toBe(runs + 1)
}

/** Types a prompt into the terminal on show and sends it. */
async function send(window: Page, prompt: string): Promise<void> {
  await window.keyboard.type(prompt)
  await window.keyboard.press('Enter')
  await expect(shownTerminal(window)).toContainText(`You wrote: ${JSON.stringify(prompt)}`)
}

test('runs two Sessions in tabs, and switching between them keeps what each printed', async () => {
  const window = await launch()

  await newSession(window)
  await send(window, 'first')
  await send(window, '/work 1500')
  await newSession(window)
  await expect(shownTerminal(window)).toContainText('Fake Claude Code')
  await send(window, 'second')

  // Each tab takes the name Claude Code gives its terminal.
  const first = window.getByRole('tab', { name: 'first' })
  const second = window.getByRole('tab', { name: 'second' })
  await expect(second).toHaveAttribute('aria-selected', 'true')
  await expect(shownTerminal(window)).not.toContainText('first')
  // The first Session finishes its turn in the background.
  await expect(first).toHaveAccessibleDescription('Done', { timeout: 15_000 })

  await first.click()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(shownTerminal(window)).toContainText('You wrote: "first"')
  await expect(shownTerminal(window)).toContainText('Done.')
  await expect(shownTerminal(window)).not.toContainText('second')
  await send(window, 'again')

  await second.click()
  await expect(shownTerminal(window)).toContainText('You wrote: "second"')
  await expect(shownTerminal(window)).not.toContainText('again')

  // Both started in the current Project, and neither was started again.
  const project = env.projects['harbor-api']
  expect((await sessionRuns(env)).map(({ cwd }) => cwd)).toEqual([project, project])
})

test('gives only the terminal on show a WebGL renderer, and keeps it through many switches', async () => {
  const window = await launch({ gpuRendering: true })
  const hasWebgl = await window.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null)
  test.skip(!hasWebgl, 'This machine has no WebGL2.')
  // The live WebGL contexts, in the terminal on show and in the hidden ones.
  const webglContexts = () =>
    window.evaluate(() => {
      // A canvas that holds a WebGL context has no 2D context to give.
      const count = (panels: string): number =>
        [...document.querySelectorAll<HTMLCanvasElement>(`${panels} canvas`)].filter(
          (canvas) => canvas.getContext('2d') === null && !canvas.getContext('webgl2')?.isContextLost()
        ).length
      return { onShow: count('[role="tabpanel"]:not([hidden])'), hidden: count('[role="tabpanel"][hidden]') }
    })
  const show = async (tab: Locator): Promise<void> => {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect.poll(async () => (await webglContexts()).onShow).toBeGreaterThan(0)
    expect((await webglContexts()).hidden).toBe(0)
  }

  await newSession(window)
  await newSession(window)
  const [first, second] = [window.getByRole('tab').first(), window.getByRole('tab').last()]
  await show(second)
  await show(first)

  // More switches than Chromium keeps WebGL contexts alive for one page.
  for (let i = 0; i < 10; i++) {
    await show(second)
    await show(first)
  }
})

/** The names of the processes ClaudeForge's main process started, as Windows lists them. */
const childProcessNames = (pid: number): string[] =>
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object Name`],
    { encoding: 'utf8' }
  )
    .split(/\r?\n/)
    .filter(Boolean)

test('asks before closing a Session Claude is working in, and closes an idle one at once', async () => {
  const window = await launch()
  const mainPid = await claudeforge!.app.evaluate(() => process.pid)

  await newSession(window)
  await send(window, '/work 60000')
  const working = window.getByRole('tab', { name: '/work 60000' })
  await expect(working).toHaveAccessibleDescription('Working')
  await newSession(window)
  const idle = window.getByRole('tab', { name: 'harbor-api' })
  await expect(idle).toHaveAccessibleDescription('Ready')

  const question = window.getByRole('alertdialog', { name: 'Claude is still working in this Session. Stop it?' })
  await working.getByRole('button', { name: 'Close' }).click()
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
  await expect(working).toHaveAccessibleDescription('Working')

  await working.getByRole('button', { name: 'Close' }).click()
  await question.getByRole('button', { name: 'Stop it' }).click()
  await expect(working).toBeHidden()

  await idle.getByRole('button', { name: 'Close' }).click()
  await expect(question).toBeHidden()
  await expect(window.getByRole('tab')).toHaveCount(0)
  await expect(window.getByText('Open a folder to start a Session in it.')).toBeVisible()
  // No pseudoconsole, so no `claude`, is left running.
  await expect.poll(() => childProcessNames(mainPid), { timeout: 15_000 }).not.toContain('OpenConsole.exe')
})
