import { expect, test, type Locator, type Page } from '@playwright/test'
import { callChannel, type Bridge } from '../../src/shared/api'
import type { ElementResult, ElementView } from '../../src/shared/elements'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, pickFolderInDialogs, type RunningClaudeForge } from './claudeforge'

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

/** Starts ClaudeForge and opens harbor-api with "Open folder", with GPU rendering off so the terminal can be read. */
async function openFolder(): Promise<Page> {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('switch', { name: 'GPU rendering' }).click()
  await window.keyboard.press('Escape')
  await pickFolderInDialogs(app, env.projects['harbor-api'])
  await window.getByRole('button', { name: 'Open folder' }).click()
  await expect(terminalOf(window)).toContainText('Fake Claude Code')
  return window
}

/** Has the fake `claude` run a command in its shell, as Claude's Bash tool would, and waits for what it printed. */
async function run(window: Page, command: string, printed: string): Promise<void> {
  await window.keyboard.type(`!${command}`)
  await window.keyboard.press('Enter')
  await expect(terminalOf(window)).toContainText(printed)
}

/** harbor-api's Created Elements, as the interface reads them through its bridge. */
async function createdElements(window: Page): Promise<ElementView[]> {
  const result = await window.evaluate(
    ([channel, project]) =>
      (globalThis as unknown as { claudeforge: Bridge }).claudeforge.call(channel, { op: 'list', project }) as Promise<ElementResult<'list'>>,
    [callChannel('elements', 'request'), env.projects['harbor-api']] as const
  )
  return result.ok ? result.elements.filter((element) => element.project !== null) : []
}

test("a Hosted session's Claude creates and fills Elements of its Project through the ClaudeForge CLI", async () => {
  const window = await openFolder()

  await run(window, 'claudeforge create panel-tab:tests --title Tests', 'Created panel-tab:tests.')
  await run(window, 'claudeforge add panel-tab:tests --id summary --text "12 passed"', 'Added summary to panel-tab:tests.')
  await run(window, 'claudeforge add panel-tab:tests --id ci --link https://ci.example/run/1 --show', 'Added ci to panel-tab:tests.')
  await run(window, 'claudeforge create menu:tests', 'Created menu:tests.')
  await run(window, 'claudeforge set menu:tests backgroundColor=#ffeeaa', 'Set backgroundColor on menu:tests.')
  await run(window, 'claudeforge add menu:tests --text "Hello"', 'menu:tests takes link, action only, not text.')

  await expect.poll(() => createdElements(window)).toEqual([
    expect.objectContaining({
      id: 'panel-tab:tests',
      attention: 'front',
      properties: expect.objectContaining({ title: 'Tests' }),
      items: [
        expect.objectContaining({ id: 'summary', kind: 'text', text: '12 passed', writtenBy: expect.objectContaining({ kind: 'session' }) }),
        expect.objectContaining({ id: 'ci', kind: 'link', address: 'https://ci.example/run/1' })
      ]
    }),
    expect.objectContaining({ id: 'menu:tests', items: [], properties: expect.objectContaining({ backgroundColor: '#ffeeaa' }) })
  ])
})

test('claudeforge --help documents the commands to a Hosted session', async () => {
  const window = await openFolder()

  // The help is longer than the terminal is tall: its last lines show.
  await run(window, 'claudeforge --help', '--help              This help.Exit code 0')
})
