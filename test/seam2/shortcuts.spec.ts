import { readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { Shortcut } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment, type FixtureProject } from '../fake-env'
import { launchClaudeForge, sessionRuns, type RunningClaudeForge } from './claudeforge'

/** What the Shortcuts journeys read and click, in each language ClaudeForge speaks. */
const LOCALES = [
  {
    language: 'en',
    systemLanguages: ['en-US'],
    card: 'Shortcuts',
    add: 'New Shortcut',
    editTitle: 'Edit Shortcut',
    webPage: 'Web page',
    skill: 'Skill',
    name: 'Name',
    address: 'Address',
    writeCommand: 'Write a command',
    chooseSkill: 'Choose a skill',
    command: 'Command',
    args: 'Arguments',
    addButton: 'Add',
    save: 'Save',
    actions: 'Shortcut actions',
    edit: 'Edit',
    delete: 'Delete',
    nameMissing: 'Give the Shortcut a name.',
    addressInvalid: 'Enter an http, https or file address.',
    commandForbidden: 'The command cannot hold a ", a % or a line break.',
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    openInBrowser: 'Open in browser',
    hostedSessions: 'Hosted sessions',
    newSession: 'New Session',
    collapse: 'Collapse the explorer',
    expand: 'Expand the explorer',
    settings: 'Settings',
    gpu: 'GPU rendering',
    typed: 'Typed, not sent',
    ready: (name: string) => `Ready to run ${name}. Check the command below, then press Enter.`,
    busy: (session: string) => `Claude is working in ${session}. Nothing was typed: try again when the Session is ready.`,
    missing: (project: string) => `This skill doesn't exist in ${project}`
  },
  {
    language: 'fr',
    systemLanguages: ['fr-FR', 'en-US'],
    card: 'Raccourcis',
    add: 'Nouveau Raccourci',
    editTitle: 'Modifier le Raccourci',
    webPage: 'Page web',
    skill: 'Skill',
    name: 'Nom',
    address: 'Adresse',
    writeCommand: 'Écrire une commande',
    chooseSkill: 'Choisir un skill',
    command: 'Commande',
    args: 'Arguments',
    addButton: 'Ajouter',
    save: 'Enregistrer',
    actions: 'Actions du Raccourci',
    edit: 'Modifier',
    delete: 'Supprimer',
    nameMissing: 'Donnez un nom au Raccourci.',
    addressInvalid: 'Saisissez une adresse http, https ou file.',
    commandForbidden: 'La commande ne peut contenir ni ", ni %, ni retour à la ligne.',
    back: 'Précédent',
    forward: 'Suivant',
    reload: 'Recharger',
    openInBrowser: 'Ouvrir dans le navigateur',
    hostedSessions: 'Sessions hébergées',
    newSession: 'Nouvelle Session',
    collapse: "Replier l'explorateur",
    expand: "Déplier l'explorateur",
    settings: 'Paramètres',
    gpu: 'Rendu GPU',
    typed: 'Tapée, non envoyée',
    ready: (name: string) => `Prêt à lancer ${name}. Vérifiez la commande ci-dessous, puis appuyez sur Entrée.`,
    busy: (session: string) => `Claude travaille dans ${session}. Rien n’a été tapé : réessayez quand la Session est prête.`,
    missing: (project: string) => `Ce skill n’existe pas dans ${project}`
  }
] as const

type Locale = (typeof LOCALES)[number]

const FIXTURE_PAGES = resolve(__dirname, '../fixtures/web')

/** Serves test/fixtures/web on this machine, as a Project's dev server would. */
async function serveFixturePages(): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    readFile(join(FIXTURE_PAGES, path === '/' ? 'index.html' : path)).then(
      (page) => response.writeHead(200, { 'content-type': 'text/html' }).end(page),
      () => response.writeHead(404).end()
    )
  })
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  return { origin: `http://localhost:${(server.address() as AddressInfo).port}`, server }
}

/** Runs a script in the Web tab's page, from the main process, as a user gesture; null with no Web tab. */
const inWebTab = (app: ElectronApplication, script: string): Promise<unknown> =>
  app.evaluate(async ({ webContents }, script) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
    return page ? page.executeJavaScript(script, true) : null
  }, script)

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

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined
let pages: { origin: string; server: Server }

test.beforeEach(async () => {
  pages = await serveFixturePages()
})

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
  pages.server.close()
})

/** Gives ClaudeForge Shortcuts before it starts, as if the user had added them. */
const seedShortcuts = (shortcuts: Shortcut[]): Promise<void> =>
  writeFile(join(env.userDataDir, 'state.json'), JSON.stringify({ shortcuts }))

async function launch(locale: Locale, project: FixtureProject = 'recipe-box'): Promise<Page> {
  claudeforge = await launchClaudeForge(env, { project })
  const { window } = claudeforge
  await expect(window.locator('html')).toHaveAttribute('lang', locale.language)
  // GPU rendering off, so a test can read the terminal; after a restart, it is off already.
  await window.getByRole('button', { name: locale.settings }).click()
  const gpu = window.getByRole('switch', { name: locale.gpu })
  if ((await gpu.getAttribute('aria-checked')) === 'true') await gpu.click()
  await expect(gpu).toHaveAttribute('aria-checked', 'false')
  await window.keyboard.press('Escape')
  return window
}

const card = (window: Page, locale: Locale): Locator => window.getByRole('region', { name: locale.card })
const shortcutButton = (window: Page, locale: Locale, name: string): Locator =>
  card(window, locale).getByRole('listitem').filter({ hasText: name }).getByRole('button', { name, exact: true })
const tabs = (window: Page, locale: Locale): Locator =>
  window.getByRole('tablist', { name: locale.hostedSessions }).getByRole('tab')
const shownTerminal = (window: Page): Locator => window.getByRole('tabpanel')

const devServer = (origin: string): Shortcut => ({ id: 'dev', name: 'Dev server', kind: 'web', address: `${origin}/` })
const seedData: Shortcut = { id: 'seed', name: 'Seed the box', kind: 'skill', command: { mode: 'skill', skill: 'seed-data', args: '3' } }
const review: Shortcut = { id: 'review', name: 'Deep review', kind: 'skill', command: { mode: 'free', text: '/review --deep' } }

for (const locale of LOCALES) {
  test.describe(`Shortcuts (${locale.language})`, () => {
    test.beforeEach(async () => {
      env = await createFakeEnvironment({ systemLanguages: [...locale.systemLanguages] })
    })

    test('the form adds a Web and a Skill shortcut, refusing a missing name, another scheme and forbidden characters', async () => {
      const window = await launch(locale)
      await card(window, locale).getByRole('button', { name: locale.add }).click()
      const form = window.getByRole('dialog', { name: locale.add })

      await form.getByRole('button', { name: locale.addButton }).click()
      await expect(form.getByRole('alert')).toContainText(locale.nameMissing)
      await expect(form.getByRole('alert')).toContainText(locale.addressInvalid)

      await form.getByRole('textbox', { name: locale.name }).fill('Dev server')
      await form.getByRole('textbox', { name: locale.address }).fill('ftp://localhost/files')
      await form.getByRole('button', { name: locale.addButton }).click()
      await expect(form.getByRole('alert')).toHaveText(locale.addressInvalid)

      await form.getByRole('textbox', { name: locale.address }).fill('http://localhost:5173')
      await form.getByRole('button', { name: locale.addButton }).click()
      await expect(form).toHaveCount(0)
      await expect(shortcutButton(window, locale, 'Dev server')).toBeVisible()
      await expect(card(window, locale)).toContainText('localhost:5173')

      await card(window, locale).getByRole('button', { name: locale.add }).click()
      await form.getByRole('button', { name: locale.skill, exact: true }).click()
      await form.getByRole('textbox', { name: locale.name }).fill('Deep review')
      await form.getByRole('radio', { name: locale.writeCommand }).check()
      await form.getByRole('textbox', { name: locale.command }).fill('/review "deep"')
      await expect(form.getByRole('alert')).toHaveText(locale.commandForbidden)
      await form.getByRole('button', { name: locale.addButton }).click()
      await expect(form).toBeVisible()
      await form.getByRole('textbox', { name: locale.command }).fill('/review 100%')
      await expect(form.getByRole('alert')).toHaveText(locale.commandForbidden)

      await form.getByRole('textbox', { name: locale.command }).fill('/review --deep')
      await expect(form).toContainText('> /review --deep')
      await form.getByRole('button', { name: locale.addButton }).click()
      await expect(form).toHaveCount(0)

      await expect(card(window, locale).getByRole('listitem')).toHaveText([/Dev server/, /Deep review/])
      const saved = JSON.parse(await readFile(join(env.userDataDir, 'state.json'), 'utf8'))
      expect(saved.shortcuts).toMatchObject([
        { name: 'Dev server', kind: 'web', address: 'http://localhost:5173' },
        { name: 'Deep review', kind: 'skill', command: { mode: 'free', text: '/review --deep' } }
      ])
    })

    test('Shortcuts are edited, deleted and reordered by drag and drop, and keep their order after a restart', async () => {
      await seedShortcuts([devServer(pages.origin), seedData, review])
      let window = await launch(locale)
      const rows = card(window, locale).getByRole('listitem')
      await expect(rows).toHaveText([/Dev server/, /Seed the box/, /Deep review/])

      await rows.nth(2).hover()
      await rows.nth(2).getByRole('button', { name: locale.actions }).click()
      await window.getByRole('menuitem', { name: locale.edit }).click()
      const form = window.getByRole('dialog', { name: locale.editTitle })
      await expect(form.getByRole('textbox', { name: locale.command })).toHaveValue('/review --deep')
      await form.getByRole('textbox', { name: locale.name }).fill('Careful review')
      await form.getByRole('button', { name: locale.save }).click()
      await expect(rows).toHaveText([/Dev server/, /Seed the box/, /Careful review/])

      await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 2 } })
      await expect(rows).toHaveText([/Careful review/, /Dev server/, /Seed the box/])

      await rows.nth(1).hover()
      await rows.nth(1).getByRole('button', { name: locale.actions }).click()
      await window.getByRole('menuitem', { name: locale.delete }).click()
      await expect(rows).toHaveText([/Careful review/, /Seed the box/])

      await claudeforge!.close()
      window = await launch(locale)
      await expect(card(window, locale).getByRole('listitem')).toHaveText([/Careful review/, /Seed the box/])
    })

    test('with the explorer collapsed, the rail shows each Shortcut by its initials and opens it', async () => {
      await seedShortcuts([devServer(pages.origin), seedData])
      const window = await launch(locale)
      await window.getByRole('button', { name: locale.collapse }).click()

      const rail = window.getByRole('group', { name: locale.card })
      await expect(rail.getByRole('button')).toHaveText(['DS', 'SB', ''])
      await expect(rail.getByRole('button', { name: 'Dev server' })).toHaveAttribute('title', /^Dev server/)
      await expect(rail.getByRole('button', { name: locale.add })).toBeVisible()

      await rail.getByRole('button', { name: 'Seed the box' }).click()
      await expect(window.getByRole('status', { name: locale.typed })).toContainText(locale.ready('Seed the box'))
      await expect(shownTerminal(window)).toContainText('> /seed-data 3')
    })

    test('a Web shortcut opens its page in a Web tab, isolated from the interface, and comes back after a restart', async () => {
      await seedShortcuts([devServer(pages.origin), seedData])
      let window = await launch(locale)
      const { app } = claudeforge!
      await recordBrowser(app)

      await shortcutButton(window, locale, 'Dev server').click()
      await expect(tabs(window, locale)).toHaveCount(1)
      await expect(tabs(window, locale).first()).toHaveAccessibleName('Dev server')
      await expect(tabs(window, locale).first()).toHaveAttribute('aria-selected', 'true')
      const address = window.getByRole('textbox', { name: locale.address })
      await expect(address).toHaveValue(`${pages.origin}/`)
      await expect(address).toHaveAttribute('readonly', '')
      await expect.poll(() => inWebTab(app, 'document.title')).toBe('Fixture dev server')

      // The page cannot reach ClaudeForge's bridge, and keeps its storage apart from the interface's.
      expect(await inWebTab(app, 'typeof window.claudeforge')).toBe('undefined')
      expect(await inWebTab(app, 'document.cookie')).toBe('visited=first')
      expect(await window.evaluate(() => document.cookie)).toBe('')

      // A link followed stays in the Web tab; Back and Forward walk its history.
      await inWebTab(app, "document.getElementById('next').click()")
      await expect(address).toHaveValue(`${pages.origin}/pricing.html`)
      await window.getByRole('button', { name: locale.back }).click()
      await expect(address).toHaveValue(`${pages.origin}/`)
      await window.getByRole('button', { name: locale.forward }).click()
      await expect(address).toHaveValue(`${pages.origin}/pricing.html`)
      await window.getByRole('button', { name: locale.reload }).click()
      await expect.poll(() => inWebTab(app, 'document.title')).toBe('Fixture pricing')

      // A second click shows the same Web tab; a new window goes to the default browser.
      await window.getByRole('button', { name: locale.newSession, exact: true }).click()
      await expect(tabs(window, locale)).toHaveCount(2)
      await shortcutButton(window, locale, 'Dev server').click()
      await expect(tabs(window, locale)).toHaveCount(2)
      await expect(tabs(window, locale).nth(1)).toHaveAttribute('aria-selected', 'true')
      await window.getByRole('button', { name: locale.back }).click()
      await expect(address).toHaveValue(`${pages.origin}/`)
      await inWebTab(app, "document.getElementById('blank').click()")
      await expect.poll(() => openedInBrowser(app)).toEqual(['https://example.com/docs'])
      await window.getByRole('button', { name: locale.openInBrowser }).click()
      await expect.poll(() => openedInBrowser(app)).toEqual(['https://example.com/docs', `${pages.origin}/`])
      await expect(tabs(window, locale)).toHaveCount(2)

      await claudeforge!.close()
      window = await launch(locale)
      const restored = window.getByRole('tab', { name: 'Dev server' })
      await expect(restored).toBeVisible()
      await restored.click()
      await expect.poll(() => inWebTab(claudeforge!.app, 'document.title')).toBe('Fixture dev server')
      // Signed in as before: the cookie the page set lasts across the restart.
      expect(await inWebTab(claudeforge!.app, 'document.cookie')).toBe('visited=first')
    })

    test('a Skill shortcut clears the prompt of a ready Session on show and types its command, unsent', async () => {
      await seedShortcuts([seedData])
      const window = await launch(locale)
      await window.getByRole('button', { name: locale.newSession, exact: true }).click()
      await expect(shownTerminal(window)).toContainText('Fake Claude Code')
      await shownTerminal(window).click()
      await window.keyboard.type('a draft')
      await expect(shownTerminal(window)).toContainText('> a draft')

      await shortcutButton(window, locale, 'Seed the box').click()

      await expect(shownTerminal(window)).toContainText('> /seed-data 3')
      await expect(shownTerminal(window)).not.toContainText('a draft')
      await expect(shownTerminal(window)).not.toContainText('You wrote')
      await expect(window.getByRole('status', { name: locale.typed })).toHaveCount(0)
      await window.keyboard.press('Enter')
      await expect(shownTerminal(window)).toContainText('You wrote: "/seed-data 3"')
      expect(await sessionRuns(env)).toHaveLength(1)
    })

    test('with a Web tab or no tab on show, a Skill shortcut starts a new Session with its command typed', async () => {
      await seedShortcuts([devServer(pages.origin), review])
      const window = await launch(locale)

      await shortcutButton(window, locale, 'Deep review').click()
      await expect(tabs(window, locale)).toHaveCount(1)
      await expect(window.getByRole('status', { name: locale.typed })).toContainText(locale.ready('Deep review'))
      await expect(shownTerminal(window)).toContainText('> /review --deep')

      await shortcutButton(window, locale, 'Dev server').click()
      await expect(tabs(window, locale).nth(1)).toHaveAttribute('aria-selected', 'true')
      await shortcutButton(window, locale, 'Deep review').click()
      // Hosted sessions come first in the tab strip, Web tabs after them.
      await expect(tabs(window, locale)).toHaveCount(3)
      await expect(tabs(window, locale).nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect(shownTerminal(window)).toContainText('> /review --deep')

      const runs = await sessionRuns(env)
      expect(runs.map(({ args, cwd }) => ({ prefill: args.slice(0, 2), cwd }))).toEqual([
        { prefill: ['--prefill', '/review --deep'], cwd: env.projects['recipe-box'] },
        { prefill: ['--prefill', '/review --deep'], cwd: env.projects['recipe-box'] }
      ])
    })

    test('with Claude working in the Session on show, a Skill shortcut types nothing and says why', async () => {
      await seedShortcuts([review])
      const window = await launch(locale)
      await window.getByRole('button', { name: locale.newSession, exact: true }).click()
      await expect(shownTerminal(window)).toContainText('Fake Claude Code')
      await shownTerminal(window).click()
      await window.keyboard.type('/work 4000')
      await window.keyboard.press('Enter')
      await expect(shownTerminal(window)).toContainText('Working…')

      await shortcutButton(window, locale, 'Deep review').click()

      await expect(window.getByRole('status').filter({ hasText: locale.busy('/work 4000') })).toBeVisible()
      await expect(shownTerminal(window)).toContainText('Done.')
      await expect(shownTerminal(window)).not.toContainText('/review')
      expect(await sessionRuns(env)).toHaveLength(1)
    })

    test("a Skill shortcut to a skill the shown Session's Project lacks is greyed out and types nothing", async () => {
      // seed-data is one of recipe-box's own skills; harbor-api has none of that name.
      await seedShortcuts([seedData, review])
      const window = await launch(locale, 'harbor-api')
      await window.getByRole('button', { name: locale.newSession, exact: true }).click()
      await expect(shownTerminal(window)).toContainText('Fake Claude Code')

      const greyed = shortcutButton(window, locale, 'Seed the box')
      await expect(greyed).toHaveAttribute('aria-disabled', 'true')
      await expect(greyed).toHaveAccessibleDescription(locale.missing('harbor-api'))
      await expect(card(window, locale).getByRole('listitem').first()).toHaveAttribute('title', locale.missing('harbor-api'))
      await expect(shortcutButton(window, locale, 'Deep review')).not.toHaveAttribute('aria-disabled')

      // A user's click still lands on it; it types nothing.
      await greyed.click({ force: true })
      await expect(shownTerminal(window)).not.toContainText('/seed-data')
      expect(await sessionRuns(env)).toHaveLength(1)
    })
  })
}
