import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { BacklogConfig, WorkItemAction } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment, type FixtureProject } from '../fake-env'
import { launchClaudeForge, sessionRuns, type RunningClaudeForge } from './claudeforge'

/** The fake `az`'s organisation, as `test/fixtures/az` records it. */
const config: BacklogConfig = {
  organization: 'https://devops.example.test/fixture-org',
  project: 'Harbor',
  areaPath: 'Harbor\\Platform & Ops',
  iterationRoot: 'Harbor\\Team Rocket'
}

/** The user's release-notes skill serves every Project; seed-data is recipe-box's own. */
const analyse: WorkItemAction = { id: 'analyse', label: 'Analyse', skill: 'release-notes', text: 'analyse #{id}: {title}', colour: 'outline' }
const seed: WorkItemAction = { id: 'seed', label: 'Seed', skill: 'seed-data', text: '{url}', colour: '#e58a7a' }

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
})

/**
 * Gives ClaudeForge a configuration and Work item actions before it starts, as if the user had saved
 * them; GPU rendering off, so a test can read the terminal.
 */
const seedState = (state: { backlog?: BacklogConfig; workItemActions?: WorkItemAction[] }): Promise<void> =>
  writeFile(join(env.userDataDir, 'state.json'), JSON.stringify({ gpuRendering: false, ...state }))

async function launch(project: FixtureProject = 'recipe-box'): Promise<Page> {
  claudeforge = await launchClaudeForge(env, { project })
  return claudeforge.window
}

const card = (window: Page): Locator => window.getByRole('region', { name: 'Work items' })
const workItem = (window: Page, id: number): Locator => card(window).getByRole('listitem').filter({ hasText: `#${id}` })
const shownTerminal = (window: Page): Locator => window.getByRole('tabpanel')

/** A day relative to today as the card writes it, `13/11`. */
function shortDay(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** The `--prefill` of each Session the fake `claude` started. */
const prefills = async (): Promise<string[]> =>
  (await sessionRuns(env)).flatMap(({ args }) => (args[0] === '--prefill' ? [args[1]!] : []))

test.describe('the Work items card', () => {
  test('connects Azure DevOps, then lists the Current sprint’s Work items, the user’s first', async () => {
    env = await createFakeEnvironment()
    await seedState({})
    const window = await launch()
    await expect(card(window)).toContainText('Show the Work items of your sprint here, from Azure DevOps.')

    await card(window).getByRole('button', { name: 'Connect Azure DevOps' }).click()
    const dialog = window.getByRole('dialog', { name: 'Configure Azure DevOps' })
    await dialog.getByLabel('Organisation').fill('fixture-org')
    await dialog.getByLabel('Project').selectOption('Harbor')
    await dialog.getByLabel('Area path').selectOption('Harbor\\Platform & Ops')
    await dialog.getByLabel('Iteration root').selectOption('Harbor\\Team Rocket')
    await dialog.getByRole('button', { name: 'Test' }).click()
    await expect(dialog.getByRole('status')).toHaveText(
      `Sprint 42, ${shortDay(-10)} to ${shortDay(4)} · 7 Work items: 2 assigned to you, 5 unassigned`
    )

    // The first action, with a placeholder inserted, then a second in coral.
    const first = dialog.getByRole('group', { name: 'Work item actions 1' })
    await first.getByLabel('Label').fill('Analyse')
    await first.getByLabel('Skill').selectOption('release-notes')
    await first.getByLabel('Text').fill('analyse #')
    await first.getByRole('button', { name: '{id}' }).click()
    await expect(first.getByLabel('Text')).toHaveValue('analyse #{id}')
    await expect(first).toContainText('> /release-notes analyse #1101')
    await dialog.getByRole('button', { name: 'Add an action' }).click()
    const second = dialog.getByRole('group', { name: 'Work item actions 2', exact: true })
    await second.getByLabel('Label').fill('Seed')
    await second.getByLabel('Skill').selectOption('seed-data')
    await second.getByRole('button', { name: 'Coral' }).click()
    await expect(second.getByRole('button', { name: 'Coral' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    await expect(card(window)).toContainText(`Sprint 42 · until ${shortDay(4)}`)
    await expect(card(window).getByRole('button', { name: 'Assigned to me · 2' })).toHaveAttribute('aria-expanded', 'true')
    const unassigned = card(window).getByRole('button', { name: 'Unassigned · 5' })
    await expect(unassigned).toHaveAttribute('aria-expanded', 'false')
    await expect(workItem(window, 1102)).toContainText('Sauvegarde des exports hors du serveur')
    await expect(workItem(window, 1103)).toContainText('Bug#1103In Code Review')

    await unassigned.click()
    await expect(workItem(window, 1101)).toContainText('Catalogue - Amélioration de l’indexation des références')
    await expect(workItem(window, 40100)).toContainText('Epic#40100New')
    await expect(workItem(window, 1101).getByRole('button', { name: 'Analyse' })).toHaveCSS('background-color', 'rgb(176, 201, 46)')
    await expect(workItem(window, 1101).getByRole('button', { name: 'Seed' })).toHaveCSS('background-color', 'rgb(229, 138, 122)')
  })

  test('types a Work item action’s command, never sent, into a new Session of the displayed Project', async () => {
    env = await createFakeEnvironment()
    await seedState({ backlog: config, workItemActions: [{ ...analyse, text: 'analyse #{id} ({type}): {title}' }] })
    const window = await launch()

    await card(window).getByRole('button', { name: 'Unassigned · 5' }).click()
    await workItem(window, 1104).getByRole('button', { name: 'Analyse' }).click()

    await expect(window.getByRole('status', { name: 'Typed, not sent' })).toContainText(
      'Ready to run Analyse on Work item #1104. Check the command below, then press Enter.'
    )
    // The title's double quotes become single ones, so the command can be typed.
    const command = "/release-notes analyse #1104 (Task): Pas de fond sous la fenêtre 'Cookies'"
    await expect.poll(prefills).toEqual([command])
    await expect(shownTerminal(window)).toContainText(`> ${command}`)

    // Another action always opens another new Session.
    await workItem(window, 1102).getByRole('button', { name: 'Analyse' }).click()
    await expect.poll(async () => (await prefills()).length).toBe(2)
  })

  test('greys out an action whose skill the displayed Project lacks', async () => {
    env = await createFakeEnvironment()
    await seedState({ backlog: config, workItemActions: [analyse, seed] })
    const window = await launch('harbor-api')

    const greyed = workItem(window, 1102).getByRole('button', { name: 'Seed' })
    await expect(greyed).toHaveAttribute('aria-disabled', 'true')
    await expect(greyed).toHaveAttribute('title', "This skill doesn't exist in harbor-api")
    await expect(workItem(window, 1102).getByRole('button', { name: 'Analyse' })).not.toHaveAttribute('aria-disabled')
    await greyed.click({ force: true })
    expect(await prefills()).toEqual([])
  })

  test('opens a Work item’s title in a Web tab', async () => {
    env = await createFakeEnvironment()
    await seedState({ backlog: config, workItemActions: [analyse] })
    const window = await launch()

    await workItem(window, 1102).getByRole('button', { name: 'Sauvegarde des exports hors du serveur' }).click()

    await expect(window.getByRole('tab', { name: '#1102' })).toHaveAttribute('aria-selected', 'true')
    await expect(window.locator('webview')).toHaveAttribute('src', 'https://devops.example.test/fixture-org/Harbor/_workitems/edit/1102')
  })

  test('says what keeps az from reading the backlog, offers the command that puts it right, and reads again on refresh', async () => {
    env = await createFakeEnvironment({ az: 'signed-out' })
    await seedState({ backlog: config, workItemActions: [analyse] })
    const window = await launch()

    await expect(card(window).getByRole('alert')).toContainText('The Azure CLI is not signed in. Run this command in a terminal, then refresh.')
    await expect(card(window).locator('code')).toHaveText('az login')
    await card(window).getByRole('button', { name: 'Type in a terminal' }).click()
    await expect(window.getByRole('status', { name: 'Typed, not sent' })).toContainText('Ready to run az login.')
    await expect.poll(prefills).toEqual(['!az login'])

    await env.setAzMode('no-extension')
    await card(window).getByRole('button', { name: 'Refresh' }).click()
    await expect(card(window).getByRole('alert')).toContainText('The Azure CLI lacks its azure-devops extension.')
    await expect(card(window).locator('code')).toHaveText('az extension add --name azure-devops')

    await env.setAzMode('signed-in')
    await card(window).getByRole('button', { name: 'Refresh' }).click()
    await expect(workItem(window, 1102)).toBeVisible()
  })

  test('says when az is missing', async () => {
    env = await createFakeEnvironment({ az: false })
    await seedState({ backlog: config })
    const window = await launch()

    await expect(card(window).getByRole('alert')).toContainText('The Azure CLI is not installed.')
    await expect(card(window).locator('code')).toHaveText('winget install -e --id Microsoft.AzureCLI --accept-source-agreements --accept-package-agreements')
  })

  test('shows the next sprint between two, no sprint when none is to come, and an empty sprint', async () => {
    env = await createFakeEnvironment()
    await seedState({ backlog: config, workItemActions: [analyse] })
    const file = join(env.azRecordings, 'iterations.json')
    const recorded = await readFile(file, 'utf8')
    const plan = (text: string): Promise<void> => writeFile(file, text)
    // Sprint 42 ended yesterday; Sprint 43 starts in two days.
    await plan(recorded.replace('{{today+4}}', '{{today-1}}').replace('{{today+7}}', '{{today+2}}'))
    const window = await launch()

    const start = new Date()
    start.setDate(start.getDate() + 2)
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(start)
    await expect(card(window)).toContainText(`Sprint 43starts ${weekday} ${shortDay(2)}`)

    await plan(recorded.replace(/\{\{today\+(4|7|21)\}\}/g, '{{today-1}}'))
    await card(window).getByRole('button', { name: 'Refresh' }).click()
    await expect(card(window)).toContainText('No sprint running or to come under Team Rocket. Check the iteration root.')
    await expect(card(window).getByRole('button', { name: 'Configure', exact: true })).toBeVisible()

    await plan(recorded)
    await writeFile(join(env.azRecordings, 'work-items.json'), '[]')
    await card(window).getByRole('button', { name: 'Refresh' }).click()
    await expect(card(window)).toContainText('Nothing to take: no open Work item in this sprint is free or yours.')
  })

  test('is a ClaudeForge Element: collapsed and hidden like the other cards', async () => {
    env = await createFakeEnvironment()
    await seedState({ backlog: config, workItemActions: [analyse] })
    const window = await launch()
    await expect(workItem(window, 1102)).toBeVisible()

    const menu = async (item: string): Promise<void> => {
      await card(window).getByRole('heading', { name: 'Work items' }).click({ button: 'right' })
      await window.getByRole('menu', { name: 'Work items actions' }).getByRole('menuitem', { name: item, exact: true }).click()
    }
    await menu('Collapse')
    await expect(workItem(window, 1102)).toBeHidden()
    await expect(card(window)).toBeVisible()

    await menu('Hide')
    await expect(card(window)).toHaveCount(0)
  })
})
