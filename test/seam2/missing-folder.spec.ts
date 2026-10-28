import { mkdir, rm } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment, type FixtureProject } from '../fake-env'
import { launchClaudeForge, sessionRuns, type RunningClaudeForge } from './claudeforge'

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
})

/** What the user reads, in each language ClaudeForge speaks. */
const LANGUAGES = [
  {
    language: 'English',
    systemLanguages: ['en-US'],
    sessions: 'Sessions',
    terminal: 'Terminal',
    actions: { resume: 'Resume', fork: 'Fork', rename: 'Rename', hide: 'Hide', delete: 'Move to Recycle Bin' },
    newSessionIn: (project: string) => `New Session in ${project}`,
    rowGone: (folder: string) => `Its folder no longer exists, so it cannot be resumed here: ${folder}`,
    startGone: (folder: string) => `Claude Code cannot start: this folder no longer exists: ${folder}`
  },
  {
    language: 'French',
    systemLanguages: ['fr-FR', 'en-US'],
    sessions: 'Sessions',
    terminal: 'Terminal',
    actions: { resume: 'Reprendre', fork: 'Dupliquer', rename: 'Renommer', hide: 'Masquer', delete: 'Mettre à la corbeille' },
    newSessionIn: (project: string) => `Nouvelle Session dans ${project}`,
    rowGone: (folder: string) => `Son dossier n’existe plus, elle ne peut donc pas être reprise ici : ${folder}`,
    startGone: (folder: string) => `Claude Code ne peut pas démarrer : ce dossier n’existe plus : ${folder}`
  }
]

/** A string as a regular expression matching it as is, at the start. */
const startingWith = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

for (const text of LANGUAGES) {
  test.describe(`in ${text.language}`, () => {
    test.beforeEach(async () => {
      env = await createFakeEnvironment({ systemLanguages: text.systemLanguages })
    })

    const row = (window: Page, project: FixtureProject, title: RegExp): Locator =>
      window
        .getByRole('complementary', { name: text.sessions })
        .getByRole('list', { name: project })
        .getByRole('listitem')
        .filter({ hasText: title })

    test('greys out a Session whose worktree is gone, which can be tidied but not resumed, until the worktree is back', async () => {
      const worktree = env.worktrees['recipe-box@leftovers']!
      await rm(worktree, { recursive: true })
      claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
      const { window } = claudeforge
      const leftovers = row(window, 'recipe-box', /^Track leftovers in the fridge/)

      await expect(leftovers).toHaveClass(/explorer__row--missing/)
      await expect(leftovers).toHaveAttribute('title', startingWith(text.rowGone(worktree)))
      await leftovers.click({ button: 'right' })
      const menu = window.getByRole('menu')
      for (const action of [text.actions.resume, text.actions.fork]) {
        await expect(menu.getByRole('menuitem', { name: action })).toBeDisabled()
        await expect(menu.getByRole('menuitem', { name: action })).toHaveAttribute('title', text.rowGone(worktree))
      }
      for (const action of [text.actions.rename, text.actions.hide, text.actions.delete]) {
        await expect(menu.getByRole('menuitem', { name: action })).toBeEnabled()
      }
      await window.keyboard.press('Escape')

      // The worktree is made again at the same path: the catalog notices without a restart.
      await mkdir(worktree)

      await expect(leftovers).not.toHaveClass(/explorer__row--missing/)
      await expect(leftovers).toHaveAttribute('title', /^Track leftovers in the fridge/)
      await leftovers.click({ button: 'right' })
      await expect(menu.getByRole('menuitem', { name: text.actions.resume })).toBeEnabled()
    })

    test('says which folder is gone when a Session cannot start there, and never starts claude', async () => {
      const project = env.projects['harbor-api']
      await rm(project, { recursive: true })
      claudeforge = await launchClaudeForge(env, { project: 'recipe-box' })
      const { window } = claudeforge

      await window.getByRole('button', { name: text.newSessionIn('harbor-api') }).click()

      await expect(window.getByRole('main', { name: text.terminal }).getByRole('status')).toContainText(
        text.startGone(project)
      )
      expect(await sessionRuns(env)).toEqual([])
    })
  })
}
