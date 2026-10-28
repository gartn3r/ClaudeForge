import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { Shortcut } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, type RunningClaudeForge } from './claudeforge'

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
})

/** Keeps what ClaudeForge opens in the default browser from now on, for `openedInBrowser` to read. */
async function recordBrowser(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url) => void opened.push(url)
  })
}

const openedInBrowser = (app: ElectronApplication): Promise<string[] | undefined> =>
  app.evaluate(() => (globalThis as { opened?: string[] }).opened)

async function launch(): Promise<Page> {
  claudeforge = await launchClaudeForge(env)
  return claudeforge.window
}

/** Ends ClaudeForge and starts it again on the same environment. */
async function restart(): Promise<Page> {
  await claudeforge!.close()
  return launch()
}

const explorer = (window: Page): Locator => window.getByRole('complementary', { name: 'Sessions' })
const titleBar = (window: Page): Locator => window.getByRole('banner')
const card = (window: Page, title: string): Locator => explorer(window).getByRole('region', { name: title, exact: true })
const menuButton = (window: Page, title: string): Locator =>
  titleBar(window).getByRole('button', { name: title, exact: true })

/** The Elements the explorer shows, by identifier, in their order. */
const explorerOrder = (window: Page): Promise<string[]> =>
  explorer(window)
    .locator('[data-element]')
    .evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.element!))

/** Displays a past Session, so its Project becomes the displayed one. */
async function display(window: Page, project: string, session: RegExp): Promise<void> {
  await explorer(window).getByRole('group', { name: project }).getByRole('treeitem').filter({ hasText: session }).click()
}

/** Right-clicks an Element and picks an item of its menu. */
async function elementAction(window: Page, target: Locator, menu: string, item: string): Promise<void> {
  await target.click({ button: 'right' })
  await window.getByRole('menu', { name: `${menu} actions` }).getByRole('menuitem', { name: item, exact: true }).click()
}

/** Adds a Content item by hand: right-click, Add content, its kind, its fields. */
async function addItem(window: Page, target: Locator, name: string, kind: string, fields: Record<string, string>): Promise<void> {
  await elementAction(window, target, name, 'Add content')
  const form = window.getByRole('dialog', { name: `Add content to ${name}` })
  await form.getByRole('button', { name: kind, exact: true }).click()
  for (const [field, value] of Object.entries(fields)) await form.getByRole('textbox', { name: field, exact: true }).fill(value)
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form).toHaveCount(0)
}

/** Creates a card or a menu with its +, giving a title and keeping the identifier it suggests. */
async function create(window: Page, plus: Locator, dialog: string, title: string, identifier: string): Promise<void> {
  await plus.click()
  const form = window.getByRole('dialog', { name: dialog })
  await form.getByRole('textbox', { name: 'Title' }).fill(title)
  await expect(form.getByRole('textbox', { name: 'Identifier' })).toHaveValue(identifier)
  await form.getByRole('button', { name: 'Create' }).click()
  await expect(form).toHaveCount(0)
}

/** Gives ClaudeForge Elements before it starts, as if they had been made in an earlier run. */
const seedElements = (state: object): Promise<void> => writeFile(join(env.userDataDir, 'elements.json'), JSON.stringify(state))

test.describe('cards and menus', () => {
  test.beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  test('the explorer + creates a card in the displayed Project, which shows texts, links, files and actions added by hand', async () => {
    let window = await launch()
    await recordBrowser(claudeforge!.app)
    await create(window, explorer(window).getByRole('button', { name: 'New card' }), 'New card', 'Release', 'release')

    const release = card(window, 'Release')
    // Right-clicked on its title: its Content items answer a right-click with their own menu.
    const head = release.getByRole('heading', { name: 'Release' })
    await expect(release).toBeVisible()
    await expect(release).toContainText('card:release')
    expect(await explorerOrder(window)).toEqual(['shortcuts', 'sessions', 'extensions', 'card:release'])

    // A card takes no web page.
    await elementAction(window, head, 'Release', 'Add content')
    const form = window.getByRole('dialog', { name: 'Add content to Release' })
    await expect(form.getByRole('group', { name: 'Kind of content' }).getByRole('button')).toHaveText(['Text', 'Link', 'File', 'Action'])
    await form.getByRole('button', { name: 'Cancel' }).click()

    await addItem(window, head, 'Release', 'Text', { Text: 'Code freeze on **Friday**.' })
    await addItem(window, head, 'Release', 'Link', { Title: 'Release notes', Address: 'https://example.com/notes' })
    const map = join(env.projects['recipe-box'], '.scratch', 'meal-planner', 'map.md')
    await addItem(window, head, 'Release', 'File', { Title: 'Meal planner map', File: map })
    await addItem(window, head, 'Release', 'Action', { Title: 'Prepare the release', Command: '/release-notes' })

    await expect(release.locator('strong')).toHaveText('Friday')
    await expect(release.getByRole('button', { name: /Release notes/ })).toContainText('example.com')
    await expect(release.getByRole('button', { name: /Meal planner map/ })).toBeVisible()
    await expect(release.getByRole('button', { name: /Prepare the release/ })).toContainText('> /release-notes')
    await release.getByRole('button', { name: /Release notes/ }).click()
    await expect.poll(() => openedInBrowser(claudeforge!.app)).toEqual(['https://example.com/notes'])

    // It belongs to recipe-box: it goes while harbor-api is displayed, and comes back with recipe-box.
    await display(window, 'harbor-api', /Add an OpenAPI export/)
    await expect(card(window, 'Release')).toHaveCount(0)
    await display(window, 'recipe-box', /Chart the meal planner/)
    await expect(card(window, 'Release')).toBeVisible()

    window = await restart()
    await expect(card(window, 'Release').getByRole('button')).toHaveText([/Release notes/, /Meal planner map/, /Prepare the release/])
    await expect(card(window, 'Release')).toContainText('Code freeze on Friday.')
  })

  test('the title bar + creates a menu in the displayed Project, which shows links and actions added by hand', async () => {
    let window = await launch()
    await create(window, titleBar(window).getByRole('button', { name: 'New menu' }), 'New menu', 'Tests', 'tests')
    const tests = menuButton(window, 'Tests')
    await expect(tests).toBeVisible()

    // A menu takes links and actions only.
    await elementAction(window, tests, 'Tests', 'Add content')
    const form = window.getByRole('dialog', { name: 'Add content to Tests' })
    await expect(form.getByRole('group', { name: 'Kind of content' }).getByRole('button')).toHaveText(['Link', 'Action'])
    await form.getByRole('button', { name: 'Cancel' }).click()

    await addItem(window, tests, 'Tests', 'Link', { Title: 'CI run', Address: 'https://ci.example.com/run/42' })
    await addItem(window, tests, 'Tests', 'Action', { Title: 'Run the tests', Command: '/run-tests --only-failed' })

    await tests.click()
    const opened = window.getByRole('dialog', { name: 'Tests' })
    await expect(opened.getByRole('button')).toHaveText([/CI run/, /Run the tests/])
    // An action types its command into a new Session of the Project, never sending it.
    await opened.getByRole('button', { name: /Run the tests/ }).click()
    await expect(opened).toHaveCount(0)
    await expect(window.getByRole('status', { name: 'Typed, not sent' })).toBeVisible()

    await display(window, 'harbor-api', /Add an OpenAPI export/)
    await expect(menuButton(window, 'Tests')).toHaveCount(0)

    window = await restart()
    await menuButton(window, 'Tests').click()
    await expect(window.getByRole('dialog', { name: 'Tests' }).getByRole('button')).toHaveText([/CI run/, /Run the tests/])
  })

  test('a Created Element that is new comes to the front; one whose content changed shows a mark until it is seen', async () => {
    await seedElements({
      version: 1,
      own: {},
      projects: {
        any: {
          path: env.projects['recipe-box'],
          elements: [
            { kind: 'card', name: 'release', properties: { title: 'Release', order: 4 }, items: [], attention: 'mark' },
            { kind: 'menu', name: 'tests', properties: { title: 'Tests', order: 1 }, items: [], attention: 'mark' }
          ]
        }
      }
    })
    const window = await launch()
    await expect(card(window, 'Release').getByRole('img', { name: 'Updated' })).toBeVisible()
    await expect(menuButton(window, 'Tests')).toHaveAttribute('data-attention', 'mark')

    await card(window, 'Release').hover()
    await expect(card(window, 'Release').getByRole('img', { name: 'Updated' })).toHaveCount(0)
    await menuButton(window, 'Tests').click()
    await window.keyboard.press('Escape')
    await expect(menuButton(window, 'Tests')).not.toHaveAttribute('data-attention', 'mark')

    // Seen, the marks stay gone after a restart.
    const saved = JSON.parse(await readFile(join(env.userDataDir, 'elements.json'), 'utf8'))
    expect(saved.projects).toMatchObject({ [Object.keys(saved.projects)[0]!]: { elements: [{ attention: null }, { attention: null }] } })
  })
})

test.describe("ClaudeForge's own Elements and the Default layout", () => {
  test.beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  test('hiding, resizing, reordering, renaming and recolouring them by hand takes effect and survives a restart', async () => {
    let window = await launch()
    const shortcuts = card(window, 'Shortcuts')

    await elementAction(window, shortcuts.getByRole('heading'), 'Shortcuts', 'Rename')
    const rename = window.getByRole('dialog', { name: 'Rename Shortcuts' })
    await rename.getByRole('textbox', { name: 'Title' }).fill('Favourites')
    await rename.getByRole('button', { name: 'Rename' }).click()
    const favourites = card(window, 'Favourites')
    await expect(favourites.getByRole('heading')).toHaveText('Favourites')

    await elementAction(window, favourites.getByRole('heading'), 'Favourites', 'Background colour')
    const colour = window.getByRole('dialog', { name: 'Background colour of Favourites' })
    await colour.getByRole('textbox', { name: 'Colour', exact: true }).fill('#f3d6c6')
    await colour.getByRole('button', { name: 'Apply' }).click()
    await expect(favourites).toHaveCSS('background-color', 'rgb(243, 214, 198)')

    await elementAction(window, card(window, 'Sessions').getByRole('heading', { name: 'Sessions' }), 'Sessions', 'Move up')
    await expect.poll(() => explorerOrder(window)).toEqual(['sessions', 'shortcuts', 'extensions'])

    await elementAction(window, card(window, 'Extensions'), 'Extensions', 'Hide')
    await expect(card(window, 'Extensions')).toHaveCount(0)

    await elementAction(window, titleBar(window).getByText('ClaudeForge'), 'Title bar', 'Text colour')
    const text = window.getByRole('dialog', { name: 'Text colour of Title bar' })
    await text.getByRole('textbox', { name: 'Colour', exact: true }).fill('#3b3f73')
    await text.getByRole('button', { name: 'Apply' }).click()
    await expect(titleBar(window)).toHaveCSS('color', 'rgb(59, 63, 115)')

    const splitter = window.getByRole('separator', { name: 'Resize the explorer' })
    await splitter.focus()
    await window.keyboard.press('End')
    await expect(splitter).toHaveAttribute('aria-valuenow', '420')

    window = await restart()
    await expect(card(window, 'Favourites')).toHaveCSS('background-color', 'rgb(243, 214, 198)')
    expect(await explorerOrder(window)).toEqual(['sessions', 'shortcuts'])
    await expect(titleBar(window)).toHaveCSS('color', 'rgb(59, 63, 115)')
    await expect(window.getByRole('separator', { name: 'Resize the explorer' })).toHaveAttribute('aria-valuenow', '420')
  })

  test('Restore default layout brings back their properties, shows and expands Created Elements, keeps their titles and colours, removes nothing', async () => {
    await seedElements({
      version: 1,
      own: {
        shortcuts: { title: 'Favourites', backgroundColor: '#f3d6c6', order: 5 },
        extensions: { visible: false },
        'title-bar': { textColor: '#3b3f73' }
      },
      projects: {
        any: {
          path: env.projects['recipe-box'],
          elements: [
            {
              kind: 'card',
              name: 'release',
              properties: { title: 'Release v2', backgroundColor: '#dcdcf3', collapsed: true, order: 4 },
              items: [{ id: 'notes', kind: 'text', text: 'Code freeze on Friday.', writtenBy: { kind: 'user' } }],
              attention: null
            },
            { kind: 'menu', name: 'tests', properties: { title: 'Tests', visible: false, order: 1 }, items: [], attention: null }
          ]
        }
      }
    })
    const window = await launch()
    expect(await explorerOrder(window)).toEqual(['sessions', 'card:release', 'shortcuts'])
    await expect(card(window, 'Release v2')).not.toContainText('Code freeze')
    await expect(menuButton(window, 'Tests')).toHaveCount(0)

    await titleBar(window).getByRole('button', { name: 'Restore default layout' }).click()

    await expect.poll(() => explorerOrder(window)).toEqual(['shortcuts', 'sessions', 'extensions', 'card:release'])
    await expect(card(window, 'Shortcuts')).toHaveCSS('background-color', 'rgb(251, 249, 242)')
    await expect(titleBar(window)).toHaveCSS('color', 'rgb(47, 53, 63)')
    // Created Elements are shown and expanded again, with their titles and colours.
    await expect(card(window, 'Release v2')).toContainText('Code freeze on Friday.')
    await expect(card(window, 'Release v2')).toHaveCSS('background-color', 'rgb(220, 220, 243)')
    await expect(menuButton(window, 'Tests')).toBeVisible()
  })

  test('Keep as Shortcut copies a link or an action into the Shortcuts card, and the two then live apart', async () => {
    await seedElements({
      version: 1,
      own: {},
      projects: {
        any: {
          path: env.projects['recipe-box'],
          elements: [
            {
              kind: 'card',
              name: 'release',
              properties: { title: 'Release', order: 4 },
              items: [{ id: 'notes', kind: 'link', title: 'Release notes', address: 'https://example.com/notes', writtenBy: { kind: 'user' } }],
              attention: null
            },
            {
              kind: 'menu',
              name: 'tests',
              properties: { title: 'Tests', order: 1 },
              items: [{ id: 'rerun', kind: 'action', title: 'Run the tests', command: '/run-tests', writtenBy: { kind: 'user' } }],
              attention: null
            }
          ]
        }
      }
    })
    const window = await launch()
    const release = card(window, 'Release')
    await release.getByRole('button', { name: /Release notes/ }).click({ button: 'right' })
    await window.getByRole('menu', { name: 'Content actions' }).getByRole('menuitem', { name: 'Keep as Shortcut' }).click()

    await menuButton(window, 'Tests').click()
    await window.getByRole('dialog', { name: 'Tests' }).getByRole('button', { name: /Run the tests/ }).click({ button: 'right' })
    await window.getByRole('menu', { name: 'Content actions' }).getByRole('menuitem', { name: 'Keep as Shortcut' }).click()

    await expect(card(window, 'Shortcuts').getByRole('listitem')).toHaveText([/Release notes/, /Run the tests/])
    // Removing the link from the card leaves the Shortcut.
    await release.getByRole('button', { name: /Release notes/ }).click({ button: 'right' })
    await window.getByRole('menu', { name: 'Content actions' }).getByRole('menuitem', { name: 'Remove' }).click()
    await expect(release.getByRole('button', { name: /Release notes/ })).toHaveCount(0)
    await expect(card(window, 'Shortcuts').getByRole('listitem')).toHaveText([/Release notes/, /Run the tests/])
    const saved: { shortcuts: Shortcut[] } = JSON.parse(await readFile(join(env.userDataDir, 'state.json'), 'utf8'))
    expect(saved.shortcuts).toMatchObject([
      { name: 'Release notes', kind: 'web', address: 'https://example.com/notes' },
      { name: 'Run the tests', kind: 'skill', command: { mode: 'free', text: '/run-tests' } }
    ])
  })
})

test.describe('in French', () => {
  test.beforeEach(async () => {
    env = await createFakeEnvironment({ systemLanguages: ['fr-FR', 'en-US'] })
  })

  test('the + buttons, the creation form and Restore default layout speak French', async () => {
    const window = await launch()
    await explorer(window).getByRole('button', { name: 'Nouvelle card' }).click()
    const form = window.getByRole('dialog', { name: 'Nouvelle card' })
    await form.getByRole('textbox', { name: 'Titre' }).fill('Été 2026')
    await expect(form.getByRole('textbox', { name: 'Identifiant' })).toHaveValue('ete-2026')
    await form.getByRole('button', { name: 'Créer' }).click()
    await expect(card(window, 'Été 2026')).toContainText('card:ete-2026')
    await expect(titleBar(window).getByRole('button', { name: 'Nouveau menu' })).toBeVisible()
    await expect(titleBar(window).getByRole('button', { name: 'Disposition par défaut' })).toBeVisible()
  })
})
