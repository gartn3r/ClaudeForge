import { mkdir, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { inWebTab, launchClaudeForge, serveFixturePages, type RunningClaudeForge } from './claudeforge'
import { addContent, createPanelTab, menuItems, panelTabs } from './panel-tabs'

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

const sessionRow = (window: Page, project: string, title: string): Locator =>
  window
    .getByRole('complementary', { name: 'Sessions' })
    .getByRole('group', { name: project })
    .getByRole('treeitem')
    .filter({ hasText: title })

const widthOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())!.width

test('the Map Panel tab comes first; + creates a Panel tab in the displayed Project, which comes to the front, stays after a restart and goes while another Project is displayed', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  let { window } = claudeforge
  await expect(panelTabs(window)).toHaveText(['Map'])
  await expect(window.getByRole('complementary', { name: 'Map' }).getByRole('heading', { name: 'Meal planner' })).toBeVisible()

  // The identifier follows the title until one is typed.
  await window.getByRole('button', { name: 'New Panel tab' }).click()
  const dialog = window.getByRole('dialog', { name: 'New Panel tab' })
  await expect(dialog).toContainText('In recipe-box.')
  await dialog.getByLabel('Title').fill('Test report')
  await expect(dialog.getByLabel('Identifier')).toHaveValue('test-report')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await createPanelTab(window, 'Test report', 'tests')

  await expect(panelTabs(window)).toHaveText(['Map', 'Test report'])
  await expect(panelTabs(window).filter({ hasText: 'Test report' })).toHaveAttribute('aria-selected', 'true')
  const panel = window.getByRole('complementary', { name: 'Test report' })
  await expect(panel.getByRole('heading', { name: 'Test report' })).toBeVisible()
  await expect(panel).toContainText('panel-tab:tests')
  await expect(panel).toContainText('Nothing here yet')

  // The same identifier again is refused, in the dialog.
  await window.getByRole('button', { name: 'New Panel tab' }).click()
  await window.getByRole('dialog', { name: 'New Panel tab' }).getByLabel('Identifier').fill('tests')
  await window.getByRole('dialog', { name: 'New Panel tab' }).getByRole('button', { name: 'Create' }).click()
  await expect(window.getByRole('dialog', { name: 'New Panel tab' }).getByRole('alert')).toHaveText(
    'panel-tab:tests already exists in this Project.'
  )
  await window.getByRole('dialog', { name: 'New Panel tab' }).getByRole('button', { name: 'Cancel' }).click()

  await claudeforge.close()
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  window = claudeforge.window
  await expect(panelTabs(window)).toHaveText(['Map', 'Test report'])

  await sessionRow(window, 'harbor-api', 'Add an OpenAPI export').click()
  await expect(panelTabs(window)).toHaveText(['Map'])
  await expect(window.getByRole('complementary', { name: 'Map' }).getByRole('heading', { name: 'Rate limiting' })).toBeVisible()

  await sessionRow(window, 'recipe-box', '/wayfinder meal-planner 02').click()
  await expect(panelTabs(window)).toHaveText(['Map', 'Test report'])
})

test.describe('Content items in a Panel tab', () => {
  let pages: { origin: string; server: Server }

  test.beforeEach(async () => {
    pages = await serveFixturePages()
  })

  test.afterEach(() => {
    pages.server.close()
  })

  test('each kind is added by hand and shows in the Panel tab; a change to a Panel tab not on show leaves a mark', async () => {
    const report = join(env.projects['recipe-box'], 'reports', 'tests.md')
    await mkdir(join(env.projects['recipe-box'], 'reports'), { recursive: true })
    await writeFile(report, '# 248 passed, 2 failed\n')
    claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
    const { app, window } = claudeforge
    // GPU rendering off, so the journey can read the terminal.
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('switch', { name: 'GPU rendering' }).click()
    await expect(window.getByRole('switch', { name: 'GPU rendering' })).toHaveAttribute('aria-checked', 'false')
    await window.keyboard.press('Escape')
    await createPanelTab(window, 'Test report', 'tests')
    const panel = window.getByRole('complementary', { name: 'Test report' })

    await addContent(window, 'Test report', 'Text', { Text: 'The **limiter** fails twice.' })
    await expect(panel.locator('strong', { hasText: 'limiter' })).toBeVisible()

    await addContent(window, 'Test report', 'Link', { Title: 'CI run', Address: 'https://ci.example.com/runs/42' })
    await expect(panel.getByRole('button', { name: /CI run/ })).toContainText('ci.example.com')

    await addContent(window, 'Test report', 'File', { File: report })
    await expect(panel.getByRole('region', { name: 'tests.md' })).toContainText('248 passed, 2 failed')
    // It follows the file on disk.
    await writeFile(report, '# 250 passed\n')
    await expect(panel.getByRole('region', { name: 'tests.md' })).toContainText('250 passed')

    await addContent(window, 'Test report', 'Web page', { Title: 'Dev server', Address: `${pages.origin}/` })
    await expect(panel.getByRole('region', { name: 'Dev server' })).toBeVisible()
    await expect.poll(() => inWebTab(app, 'document.title')).toBe('Fixture dev server')

    await addContent(window, 'Test report', 'Action', { Title: 'Run again', Command: '/run-tests --only-failed' })
    await panel.getByRole('button', { name: /Run again/ }).click()
    // No Session on show: a new one of the Project starts, the command typed in its prompt and not sent.
    await expect(window.getByRole('tabpanel')).toContainText('> /run-tests --only-failed')
    await expect(window.getByRole('tabpanel')).not.toContainText('You wrote')

    // A change while another Panel tab is on show leaves a mark, until the Panel tab is shown.
    await panelTabs(window).filter({ hasText: 'Map' }).click()
    const tab = panelTabs(window).filter({ hasText: 'Test report' })
    await expect(tab.getByRole('img', { name: 'Changed' })).toHaveCount(0)
    await addContent(window, 'Test report', 'Text', { Text: 'One more line.' })
    await expect(tab.getByRole('img', { name: 'Changed' })).toBeVisible()
    await tab.click()
    await expect(window.getByRole('complementary', { name: 'Test report' })).toContainText('One more line.')
    await expect(tab.getByRole('img', { name: 'Changed' })).toHaveCount(0)
  })
})

test('without a Map the Right panel opens on another Panel tab, and collapses on its own only when there is none', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })
  let { window } = claudeforge
  await expect.poll(() => widthOf(window.getByRole('complementary', { name: 'Map' }))).toBe(64)

  await window.getByRole('button', { name: 'Expand the Map panel' }).click()
  await createPanelTab(window, 'Notes', 'notes')
  await expect(window.getByRole('complementary', { name: 'Notes' })).toContainText('panel-tab:notes')

  await claudeforge.close()
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })
  window = claudeforge.window
  const panel = window.getByRole('complementary', { name: 'Notes' })
  await expect(panelTabs(window)).toHaveText(['Map', 'Notes'])
  await expect(panelTabs(window).filter({ hasText: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => widthOf(panel)).toBe(400)

  // The Map Panel tab still says why it is empty.
  await panelTabs(window).filter({ hasText: 'Map' }).click()
  await expect(window.getByRole('complementary', { name: 'Map' })).toContainText('No Map in this Project')

  // Once the last other Panel tab is closed, the panel collapses on its own again.
  await panelTabs(window).filter({ hasText: 'Notes' }).click({ button: 'right' })
  await window.getByRole('menu', { name: 'Notes actions' }).getByRole('menuitem', { name: 'Close' }).click()
  await window.getByRole('alertdialog', { name: 'Close Notes?' }).getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => widthOf(window.getByRole('complementary', { name: 'Map' }))).toBe(64)
})

test('right-click on a Panel tab and on its Content items opens their menus; the Map Panel tab can be hidden, never closed', async () => {
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const { app, window } = claudeforge
  await createPanelTab(window, 'Test report', 'tests')
  await addContent(window, 'Test report', 'Link', { Title: 'CI run', Address: 'https://ci.example.com/runs/42' })

  await panelTabs(window).filter({ hasText: 'Test report' }).click({ button: 'right' })
  await expect(menuItems(window, 'Test report actions')).toHaveText([
    'Rename',
    'Text colour',
    'Background colour',
    'Add content',
    'Hide',
    'Copy identifier',
    'Close'
  ])
  await menuItems(window, 'Test report actions').filter({ hasText: 'Copy identifier' }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('panel-tab:tests')

  await panelTabs(window).filter({ hasText: 'Test report' }).click({ button: 'right' })
  await menuItems(window, 'Test report actions').filter({ hasText: 'Rename' }).click()
  await window.getByRole('dialog', { name: 'Rename Test report' }).getByLabel('Title').fill('Tests')
  await window.getByRole('dialog', { name: 'Rename Test report' }).getByRole('button', { name: 'Rename' }).click()
  await expect(panelTabs(window)).toHaveText(['Map', 'Tests'])

  await panelTabs(window).filter({ hasText: 'Tests' }).click({ button: 'right' })
  await menuItems(window, 'Tests actions').filter({ hasText: 'Background colour' }).click()
  await window.getByRole('dialog', { name: 'Background colour of Tests' }).getByLabel('Colour', { exact: true }).fill('#f3d6c6')
  await window.getByRole('dialog', { name: 'Background colour of Tests' }).getByRole('button', { name: 'Apply' }).click()
  await expect(panelTabs(window).filter({ hasText: 'Tests' })).toHaveCSS('background-color', 'rgb(243, 214, 198)')

  await window.getByRole('complementary', { name: 'Tests' }).getByRole('button', { name: /CI run/ }).click({ button: 'right' })
  await expect(menuItems(window, 'Content actions')).toHaveText(['Keep as Shortcut', 'Edit', 'Copy identifier', 'Remove'])
  await window.keyboard.press('Escape')

  await panelTabs(window).filter({ hasText: 'Map' }).click({ button: 'right' })
  await expect(menuItems(window, 'Map actions')).toHaveText(['Rename', 'Text colour', 'Background colour', 'Hide', 'Copy identifier'])
  await menuItems(window, 'Map actions').filter({ hasText: 'Hide' }).click()
  await expect(panelTabs(window)).toHaveText(['Tests'])
  await expect(window.getByRole('complementary', { name: 'Tests' })).toBeVisible()
})

test('the Right panel speaks French', async () => {
  await env.dispose()
  env = await createFakeEnvironment({ systemLanguages: ['fr-FR', 'en-US'] })
  claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
  const { window } = claudeforge

  await expect(panelTabs(window)).toHaveText(['Carte'])
  await window.getByRole('button', { name: 'Nouveau Panel tab' }).click()
  const dialog = window.getByRole('dialog', { name: 'Nouveau Panel tab' })
  await expect(dialog).toContainText('Dans recipe-box.')
  await dialog.getByLabel('Titre').fill('Rapport de tests')
  await expect(dialog.getByLabel('Identifiant')).toHaveValue('rapport-de-tests')
  await dialog.getByRole('button', { name: 'Créer' }).click()

  const panel = window.getByRole('complementary', { name: 'Rapport de tests' })
  await expect(panel).toContainText('Rien ici pour l’instant')
  await expect(window.getByRole('button', { name: 'Replier le Right panel' })).toBeVisible()
})
