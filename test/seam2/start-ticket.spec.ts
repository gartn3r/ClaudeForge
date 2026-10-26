import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment, type FixtureProject } from '../fake-env'
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

/** Starts ClaudeForge in a Project with GPU rendering off, so a test can read the terminal. */
async function launch(project: FixtureProject): Promise<Page> {
  claudeforge = await launchClaudeForge(env, { project })
  const { window } = claudeforge
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('switch', { name: 'GPU rendering' }).click()
  await expect(window.getByRole('switch', { name: 'GPU rendering' })).toHaveAttribute('aria-checked', 'false')
  await window.keyboard.press('Escape')
  return window
}

const mapPanel = (window: Page): Locator => window.getByRole('complementary', { name: 'Map' })
const ticket = (window: Page, name: string): Locator =>
  mapPanel(window).getByRole('region', { name: 'Open work' }).getByRole('group', { name })
const tabs = (window: Page): Locator => window.getByRole('tablist', { name: 'Hosted sessions' }).getByRole('tab')
/** The banner over a Session whose prompt holds a command ClaudeForge typed. */
const banner = (window: Page): Locator => window.getByRole('status', { name: 'Typed, not sent' })
/** The terminal on show: only the active tab's terminal is in the accessibility tree. */
const shownTerminal = (window: Page): Locator => window.getByRole('tabpanel')

// recipe-box's Meal planner (test/fixtures/projects/recipe-box/.scratch/meal-planner): 01 is
// closed, 02 on the Frontier, 03 blocked by 02, 04 claimed by the user.
test('clicking a Frontier Ticket opens a new Session with its /wayfinder command typed, sent only by Enter', async () => {
  const window = await launch('recipe-box')

  await ticket(window, 'Shape of the week view').click()

  await expect(tabs(window)).toHaveCount(1)
  await expect(tabs(window).first()).toHaveAttribute('aria-selected', 'true')
  await expect(banner(window)).toContainText(
    'Ready to start Shape of the week view from Meal planner. Check the command below, then press Enter.'
  )
  await expect(shownTerminal(window)).toContainText('> /wayfinder meal-planner 02')
  const [run] = await sessionRuns(env)
  expect(run).toMatchObject({ args: ['--prefill', '/wayfinder meal-planner 02', '--session-id', expect.any(String)], cwd: env.projects['recipe-box'] })
  await expect(shownTerminal(window)).not.toContainText('You wrote')

  await window.keyboard.press('Enter')

  await expect(shownTerminal(window)).toContainText('You wrote: "/wayfinder meal-planner 02"')
  await expect(banner(window)).toHaveCount(0)
})

test('a Ticket claimed by the user starts from the Tree view too, and Cancel closes the Session unsent', async () => {
  const window = await launch('recipe-box')
  await mapPanel(window).getByRole('button', { name: 'Tree' }).click()

  await mapPanel(window).getByRole('treeitem', { name: 'Grocery list format' }).click()

  await expect(banner(window)).toContainText('Ready to start Grocery list format from Meal planner.')
  await expect(shownTerminal(window)).toContainText('> /wayfinder meal-planner 04')

  await banner(window).getByRole('button', { name: 'Cancel' }).click()

  await expect(tabs(window)).toHaveCount(0)
  await expect(window.getByRole('main')).toContainText('Open a folder to start a Session')
})

test('clicking a blocked Ticket or a Decided chip shows its details, and starts nothing', async () => {
  const window = await launch('recipe-box')

  await ticket(window, 'Carry leftovers to the next day').click()

  const details = window.getByRole('dialog', { name: 'Carry leftovers to the next day' })
  await expect(details).toContainText('research · Blocked')
  await expect(details.getByRole('region', { name: 'Question' })).toContainText(
    "How do other planners carry leftovers into the next day's meals?"
  )
  await expect(details).toContainText('Blocked by Shape of the week view.')
  await expect(details.getByRole('region', { name: 'Answer' })).toHaveCount(0)
  await expect(details.getByRole('button', { name: 'Open the issue' })).toBeVisible()

  await details.getByRole('button', { name: 'Close' }).click()
  await expect(details).toHaveCount(0)

  await mapPanel(window).getByRole('list', { name: 'Decided' }).getByRole('button', { name: 'Where recipes are stored' }).click()

  const decided = window.getByRole('dialog', { name: 'Where recipes are stored' })
  await expect(decided).toContainText('grilling · Closed')
  await expect(decided.getByRole('region', { name: 'Answer' })).toContainText('Recipes stay in markdown files.')
  await window.keyboard.press('Escape')
  await expect(decided).toHaveCount(0)

  expect(await sessionRuns(env)).toEqual([])
  await expect(tabs(window)).toHaveCount(0)
})

// harbor-api's Map #70 Webhooks: #71 Delivery guarantees is a Parent Ticket (test/fixtures/gh).
test('inside an opened Parent Ticket, a button types /wayfinder for that Ticket in a new Session', async () => {
  const window = await launch('harbor-api')
  const panel = mapPanel(window)
  await panel.getByRole('button', { name: 'Rate limiting' }).click()
  await panel.getByRole('menu', { name: 'Maps' }).getByRole('menuitemradio', { name: /Webhooks/ }).click()
  await ticket(window, 'Delivery guarantees').getByRole('button', { name: 'Open Delivery guarantees' }).click()

  await panel.getByRole('button', { name: 'Run Wayfinder on this Ticket in a new Session' }).click()

  await expect(banner(window)).toContainText(
    'Ready to run Wayfinder on Delivery guarantees as a Map of its own. Check the command below, then press Enter.'
  )
  await expect(shownTerminal(window)).toContainText('> /wayfinder #71')
  expect((await sessionRuns(env)).map(({ args }) => args.slice(0, 2))).toEqual([['--prefill', '/wayfinder #71']])
})
