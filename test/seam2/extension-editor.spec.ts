import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/** Opens the Extensions menu at a scope, once it has counted recipe-box's Extensions. */
async function openMenu(window: Page, scope: 'Global' | 'This Project · recipe-box'): Promise<Locator> {
  const bar = window.getByRole('complementary', { name: 'Sessions' }).getByRole('button', { name: /^Extensions/ })
  await expect(bar).toHaveAccessibleName(/^Extensions: \d+ skills/)
  await bar.click()
  const menu = window.getByRole('dialog', { name: 'Extensions' })
  await menu.getByRole('group', { name: 'Scope' }).getByRole('button', { name: scope }).click()
  return menu
}

const row = (menu: Locator, group: string, name: string): Locator =>
  menu.getByRole('list', { name: group }).getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) })

/** Replaces the whole text of the editor that has the focus, as pasting over a selection does. */
async function replaceText(window: Page, text: string): Promise<void> {
  await window.keyboard.press('Control+A')
  await window.keyboard.insertText(text)
}

const textOf = async (file: string): Promise<string> => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')

test('New skill creates one from the template in the Project, opens it in a tab, and saves it once its frontmatter is valid', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const window = claudeforge.window
  const menu = await openMenu(window, 'This Project · recipe-box')

  await menu.getByRole('button', { name: 'New skill' }).click()
  const dialog = window.getByRole('dialog', { name: 'New skill in recipe-box' })
  // The dialog is a card over the slate menu: its words read dark on it, not cream.
  await expect(dialog.getByRole('heading', { name: 'New skill in recipe-box' })).toHaveCSS('color', 'rgb(47, 53, 63)')
  await expect(dialog.getByText('Lowercase letters, numbers and hyphens.')).toHaveCSS('color', 'rgb(94, 100, 112)')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Menu planner')
  // Claude Code names skills in lowercase letters, numbers and hyphens.
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Name' }).fill('menu-planner')
  await dialog.getByRole('button', { name: 'Create' }).click()

  const tab = window.getByRole('tab', { name: 'menu-planner' })
  const editor = window.getByRole('tabpanel')
  const text = editor.getByRole('textbox', { name: 'Text of menu-planner' })
  const save = editor.getByRole('button', { name: 'Save' })
  const file = join(env.projects['recipe-box'], '.claude', 'skills', 'menu-planner', 'SKILL.md')
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(tab).toHaveAccessibleDescription('Skill')
  await expect(menu).toBeHidden()
  await expect(text).toBeFocused()
  await expect(text).toContainText('name: menu-planner')
  await expect(editor).toContainText(file)
  expect(await textOf(file)).toMatch(/^---\nname: menu-planner\ndescription: /)
  await expect(save).toBeDisabled()

  // A frontmatter left open and a YAML typo each block saving, saying what to fix.
  await replaceText(window, '---\nname: menu-planner\ndescription: Plans meals.\n\nPlan a week of meals.\n')
  const problems = editor.getByRole('status')
  await expect(problems).toHaveText(
    'Fix the frontmatter to save:End the frontmatter with a line of --- after its last field.'
  )
  await expect(save).toBeDisabled()
  await expect(tab).toHaveAccessibleDescription('Skill · Unsaved changes')
  await replaceText(window, '---\nname: menu-planner\ndescription: Plans meals: a week at a time.\n---\n')
  await expect(problems).toContainText('Line 3 is not valid YAML: Nested mappings are not allowed in compact mappings.')
  await expect(save).toBeDisabled()
  await window.keyboard.press('Control+S')
  expect(await textOf(file)).toMatch(/^---\nname: menu-planner\ndescription: Say what/)

  const valid = '---\nname: menu-planner\ndescription: "Plans meals: a week at a time."\n---\n\n# Menu planner\n\nPlan a week of meals.\n'
  await replaceText(window, valid)
  await expect(problems).toHaveCount(0)
  await expect(save).toBeEnabled()
  await window.keyboard.press('Control+S')

  await expect(save).toBeDisabled()
  await expect(editor).toContainText('Saved')
  await expect(tab).toHaveAccessibleDescription('Skill')
  expect(await textOf(file)).toBe(valid)
  // The menu lists it, described by its new frontmatter.
  await openMenu(window, 'This Project · recipe-box')
  await expect(row(menu, 'Skills', 'menu-planner')).toHaveAttribute('title', 'Plans meals: a week at a time.')
})

test('Edit opens a global subagent beside the Hosted sessions, keeping unsaved text until the user discards it', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const window = claudeforge.window
  const file = join(env.claudeHome, 'agents', 'code-reviewer.md')
  const before = await readFile(file, 'utf8')
  await window.getByRole('button', { name: 'New Session', exact: true }).click()
  await expect.poll(async () => (await sessionRuns(env)).length).toBe(1)
  const sessionTab = window.getByRole('tab', { name: 'recipe-box' })
  await expect(sessionTab).toHaveAttribute('aria-selected', 'true')

  let menu = await openMenu(window, 'Global')
  await row(menu, 'Subagents', 'code-reviewer').getByRole('button', { name: 'Edit code-reviewer' }).click()

  const tab = window.getByRole('tab', { name: 'code-reviewer' })
  const text = window.getByRole('textbox', { name: 'Text of code-reviewer' })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(sessionTab).toHaveAttribute('aria-selected', 'false')
  await expect(text).toContainText('tools: Read, Grep, Glob')
  await expect(text).toBeFocused()
  await window.keyboard.press('Control+End')
  await window.keyboard.type(' Keep it short.')
  await expect(tab).toHaveAccessibleDescription('Subagent · Unsaved changes')

  // The Session's terminal comes back on show, and the editor keeps its text behind it.
  await sessionTab.click()
  await expect(text).toBeHidden()
  await expect(window.getByRole('tabpanel', { name: /^recipe-box/ })).toBeVisible()
  await tab.click()
  await expect(text).toContainText('Keep it short.')
  // Editing it again shows the tab already open.
  menu = await openMenu(window, 'Global')
  await row(menu, 'Subagents', 'code-reviewer').getByRole('button', { name: 'Edit code-reviewer' }).click()
  await expect(window.getByRole('tablist', { name: 'Hosted sessions' }).getByRole('tab')).toHaveCount(2)
  await expect(text).toContainText('Keep it short.')

  await tab.getByRole('button', { name: 'Close' }).click()
  const discard = window.getByRole('alertdialog', { name: 'Discard your changes to code-reviewer?' })
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(tab).toBeVisible()
  await tab.getByRole('button', { name: 'Close' }).click()
  await discard.getByRole('button', { name: 'Discard' }).click()

  await expect(tab).toHaveCount(0)
  await expect(sessionTab).toHaveAttribute('aria-selected', 'true')
  expect(await readFile(file, 'utf8')).toBe(before)
})
