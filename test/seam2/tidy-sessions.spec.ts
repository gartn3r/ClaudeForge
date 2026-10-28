import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, encodeProjectPath, type FakeEnvironment } from '../fake-env'
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

const explorerOf = (window: Page): Locator => window.getByRole('complementary', { name: 'Sessions' })
const harborSessions = (window: Page): Locator =>
  explorerOf(window).getByRole('group', { name: 'harbor-api' }).getByRole('treeitem')
const row = (window: Page, title: string): Locator => harborSessions(window).filter({ hasText: title })
/** The design system's text-faint. */
const FAINT = 'rgb(138, 143, 153)'

test('renames a Session from its menu, and Escape leaves the name as it was', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menu').getByRole('menuitem', { name: 'Rename' }).click()
  const name = explorerOf(window).getByRole('textbox', { name: 'Session name' })
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('Add an OpenAPI export')
  await name.fill('OpenAPI, for the partners')
  await name.press('Enter')

  await expect(harborSessions(window).last()).toHaveText(/^OpenAPI, for the partners/)

  await row(window, 'OpenAPI, for the partners').hover()
  await row(window, 'OpenAPI, for the partners').getByRole('button', { name: 'Session actions' }).click()
  await window.getByRole('menuitem', { name: 'Rename' }).click()
  await name.fill('Something else')
  await name.press('Escape')

  await expect(name).toBeHidden()
  await expect(harborSessions(window).last()).toHaveText(/^OpenAPI, for the partners/)
})

test('hides a Session, shows hidden Sessions again on demand, and unhides one', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge
  const showHidden = explorerOf(window).getByRole('switch', { name: 'Show hidden Sessions of harbor-api' })
  await expect(showHidden).toBeHidden()

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Hide' }).click()

  await expect(harborSessions(window)).toHaveCount(2)
  await expect(row(window, 'Add an OpenAPI export')).toHaveCount(0)

  await showHidden.click()
  await expect(showHidden).toHaveAttribute('aria-checked', 'true')
  await expect(harborSessions(window)).toHaveCount(3)
  const hidden = row(window, 'Add an OpenAPI export')
  // Hidden Sessions show in the faint text colour.
  await expect(hidden.getByText('Add an OpenAPI export')).toHaveCSS('color', FAINT)

  await hidden.click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Unhide' }).click()

  await expect(showHidden).toBeHidden()
  await expect(row(window, 'Add an OpenAPI export').getByText('Add an OpenAPI export')).not.toHaveCSS('color', FAINT)
  await expect(harborSessions(window)).toHaveCount(3)
})

test('moves a past Session to the Recycle Bin after a confirmation, never an External one', async () => {
  claudeforge = await launchClaudeForge(env)
  const { window } = claudeforge
  const dialog = window.getByRole('alertdialog', { name: 'Move this Session to the Recycle Bin?' })

  await row(window, 'Rate limiter rewrite').click({ button: 'right' })
  await expect(window.getByRole('menuitem', { name: 'Move to Recycle Bin' })).toBeDisabled()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('menu')).toBeHidden()

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Move to Recycle Bin' }).click()
  await expect(dialog).toContainText('"Add an OpenAPI export" and its history leave ClaudeForge and Claude Code.')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await window.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(harborSessions(window)).toHaveCount(3)

  await row(window, 'Add an OpenAPI export').click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Move to Recycle Bin' }).click()
  await dialog.getByRole('button', { name: 'Move to Recycle Bin' }).click()

  await expect(dialog).toBeHidden()
  await expect(row(window, 'Add an OpenAPI export')).toHaveCount(0)
  await expect(harborSessions(window)).toHaveCount(2)
  expect(await env.recycled()).toEqual([
    join(env.claudeHome, 'projects', encodeProjectPath(env.projects['harbor-api']), '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11.jsonl')
  ])
})

const recipeSessions = (window: Page): Locator =>
  explorerOf(window).getByRole('group', { name: 'recipe-box' }).getByRole('treeitem')
const anyRow = (window: Page, title: string): Locator => explorerOf(window).getByRole('treeitem').filter({ hasText: title })
const picked = (window: Page): Locator => explorerOf(window).getByRole('treeitem', { selected: true })

const PAGINATE = 'Paginate the audit log endpoint with cursors'
const OPENAPI = 'Add an OpenAPI export'
const PAGINATE_ID = 'c3d2a8f1-1b7e-4c59-9e64-7f0a1d2b3c4d'
const OPENAPI_ID = '5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11'
const harborHistories = (): string => join(env.claudeHome, 'projects', encodeProjectPath(env.projects['harbor-api']))

/** What the batch deletion says, in each language ClaudeForge speaks. */
const LOCALES = [
  {
    language: 'en',
    systemLanguages: ['en-US'],
    deleteMany: (n: number) => `Move ${n} Sessions to Recycle Bin`,
    title: (n: number) => `Move ${n} Session${n === 1 ? '' : 's'} to the Recycle Bin?`,
    confirm: 'Move to Recycle Bin',
    skipped: '1 Session of the selection is still running, so it stays',
    failed: (title: string) => `ClaudeForge could not move the history of "${title}" to the Recycle Bin.`
  },
  {
    language: 'fr',
    systemLanguages: ['fr-FR', 'en-US'],
    deleteMany: (n: number) => `Mettre ${n} Sessions à la corbeille`,
    title: (n: number) => `Mettre ${n} Session${n === 1 ? '' : 's'} à la corbeille ?`,
    confirm: 'Mettre à la corbeille',
    skipped: '1 Session de la sélection tourne encore, elle reste donc',
    failed: (title: string) => `ClaudeForge n’a pas pu mettre l’historique de « ${title} » à la corbeille.`
  }
]

for (const locale of LOCALES) {
  test.describe(`multi-selection (${locale.language})`, () => {
    test.beforeEach(async () => {
      await env.dispose()
      env = await createFakeEnvironment({ systemLanguages: locale.systemLanguages })
    })

    test('picks Sessions with Ctrl and Shift clicks across Projects, resets on a plain click, and lets go on Escape', async () => {
      claudeforge = await launchClaudeForge(env)
      const { window } = claudeforge
      await expect(window.locator('html')).toHaveAttribute('lang', locale.language)
      await expect(explorerOf(window).getByRole('tree')).toHaveAttribute('aria-multiselectable', 'true')

      await row(window, PAGINATE).click()
      await expect(row(window, PAGINATE)).toHaveAttribute('aria-current', 'true')
      await expect(picked(window)).toHaveText([new RegExp(`^${PAGINATE}`)])

      await row(window, OPENAPI).click({ modifiers: ['Control'] })
      await expect(picked(window)).toHaveText([new RegExp(`^${PAGINATE}`), new RegExp(`^${OPENAPI}`)])
      // Picking does not display: the Session shown stays the one plainly clicked.
      await expect(row(window, PAGINATE)).toHaveAttribute('aria-current', 'true')
      await expect(row(window, OPENAPI)).not.toHaveAttribute('aria-current', 'true')

      await row(window, PAGINATE).click({ modifiers: ['Control'] })
      await expect(row(window, PAGINATE)).toHaveAttribute('aria-selected', 'false')
      await expect(picked(window)).toHaveText([new RegExp(`^${OPENAPI}`)])

      // From the last clicked row, even one Ctrl+click let go of, in the explorer's order, into the next Project.
      await anyRow(window, '/wayfinder meal-planner 02').click({ modifiers: ['Shift'] })
      await expect(picked(window)).toHaveText([
        new RegExp(`^${PAGINATE}`),
        new RegExp(`^${OPENAPI}`),
        /^Chart the meal planner/,
        /^\/wayfinder meal-planner 02/
      ])

      await anyRow(window, 'Track leftovers in the fridge').click()
      await expect(picked(window)).toHaveText([/^Track leftovers in the fridge/])
      await expect(recipeSessions(window).last()).toHaveAttribute('aria-current', 'true')

      await row(window, 'Rate limiter rewrite').click({ modifiers: ['Control'] })
      await expect(picked(window)).toHaveCount(2)
      await window.keyboard.press('Escape')
      await expect(picked(window)).toHaveCount(0)
    })

    test('moves the past Sessions of a selection to the Recycle Bin after one confirmation, leaving out a running one', async () => {
      claudeforge = await launchClaudeForge(env)
      const { window } = claudeforge
      const dialog = window.getByRole('alertdialog', { name: locale.title(2) })

      await row(window, OPENAPI).click()
      await row(window, 'Rate limiter rewrite').click({ modifiers: ['Shift'] })
      await expect(picked(window)).toHaveCount(3)

      await row(window, PAGINATE).click({ button: 'right' })
      await window.getByRole('menuitem', { name: locale.deleteMany(3) }).click()
      await expect(dialog.getByRole('listitem')).toHaveText([PAGINATE, OPENAPI])
      await expect(dialog).toContainText(locale.skipped)
      await dialog.getByRole('button', { name: locale.confirm }).click()

      await expect(dialog).toBeHidden()
      await expect(harborSessions(window)).toHaveText([/^Rate limiter rewrite/])
      expect((await env.recycled()).sort()).toEqual(
        [join(harborHistories(), `${PAGINATE_ID}.jsonl`), join(harborHistories(), `${OPENAPI_ID}.jsonl`)].sort()
      )
    })

    test('picks and deletes a greyed Session whose folder is gone like any other past Session', async () => {
      const worktree = env.worktrees['recipe-box@leftovers']!
      await rm(worktree, { recursive: true })
      claudeforge = await launchClaudeForge(env)
      const { window } = claudeforge
      const leftovers = anyRow(window, 'Track leftovers in the fridge')
      await expect(leftovers).toHaveClass(/explorer__row--missing/)

      await anyRow(window, 'Chart the meal planner').click()
      await leftovers.click({ modifiers: ['Control'] })
      await expect(leftovers).toHaveAttribute('aria-selected', 'true')
      await leftovers.click({ button: 'right' })
      await window.getByRole('menuitem', { name: locale.deleteMany(2) }).click()
      const dialog = window.getByRole('alertdialog', { name: locale.title(2) })
      await expect(dialog.getByRole('listitem')).toHaveText(['Chart the meal planner', /^Track leftovers in the fridge/])
      await dialog.getByRole('button', { name: locale.confirm }).click()

      await expect(dialog).toBeHidden()
      await expect(recipeSessions(window)).toHaveCount(1)
      expect(await env.recycled()).toEqual([
        join(env.claudeHome, 'projects', encodeProjectPath(env.projects['recipe-box']), '7a4f0e19-5c2b-4d8a-b3e6-91c0f2d4a5b7.jsonl'),
        join(env.claudeHome, 'projects', encodeProjectPath(worktree), 'f6c9d2e1-3a5b-4c7d-9e0f-1a2b3c4d5e6f.jsonl')
      ])
    })

    test('deletes the selection on the Delete key, and reports by title a Session whose files are held open', async () => {
      const subagents = join(harborHistories(), PAGINATE_ID, 'subagents')
      await mkdir(subagents, { recursive: true })
      await writeFile(join(subagents, 'agent-a1.jsonl'), '')
      // Held open, as an editor would: Windows refuses to move its folder.
      const held = await open(join(subagents, 'agent-a1.jsonl'))
      try {
        claudeforge = await launchClaudeForge(env)
        const { window } = claudeforge
        const dialog = window.getByRole('alertdialog')

        await row(window, OPENAPI).click()
        await row(window, PAGINATE).click({ modifiers: ['Control'] })
        await window.keyboard.press('Delete')
        await expect(dialog).toHaveAccessibleName(locale.title(2))
        await dialog.getByRole('button', { name: locale.confirm }).click()

        await expect(dialog.getByRole('alert')).toContainText(locale.failed(PAGINATE))
        await expect(dialog).toHaveAccessibleName(locale.title(1))
        await expect(dialog.getByRole('listitem')).toHaveText([PAGINATE])
        await expect(row(window, OPENAPI)).toHaveCount(0)
        await expect(row(window, PAGINATE)).toHaveCount(1)
        expect(await env.recycled()).toEqual([join(harborHistories(), `${OPENAPI_ID}.jsonl`)])

        await held.close()
        await dialog.getByRole('button', { name: locale.confirm }).click()
        await expect(dialog).toBeHidden()
        await expect(row(window, PAGINATE)).toHaveCount(0)
      } finally {
        await held.close()
      }
    })
  })
}
