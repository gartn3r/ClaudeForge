import { spawn, type ChildProcess } from 'node:child_process'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment, type FakeEnvironmentOptions } from '../fake-env'
import { launchClaudeForge, sessionRuns, type RunningClaudeForge } from './claudeforge'

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined
const children: ChildProcess[] = []

const setUp = async (options?: FakeEnvironmentOptions): Promise<void> => {
  env = await createFakeEnvironment(options)
}

test.afterEach(async () => {
  for (const child of children.splice(0)) child.kill()
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
})

const explorerOf = (name: string): Locator => claudeforge!.window.getByRole('complementary', { name })

/** A list of Session ids cut short, as a crash in the middle of writing it would leave it. */
const CORRUPT_LIST = '{"version":1,"ids":["5b0c7f0e-3f7a-4d0e-9a51-2f4c1f0d8a11",'

/** Where ClaudeForge set the unreadable list aside, beside the new one. */
const setAsideFile = async (): Promise<string> => {
  const [name] = (await readdir(env.userDataDir)).filter((file) => file.startsWith('session-ids.unreadable-'))
  return join(env.userDataDir, name!)
}

test('leaves out the conversations that never ran in ClaudeForge, finished or still running elsewhere', async () => {
  await setUp()
  const cwd = env.projects.dotfiles
  const prompt = { type: 'user', cwd, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Tidy my aliases' } }
  await env.writeHistory(cwd, '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d', [prompt], { listed: false })
  const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { stdio: 'ignore' })
  children.push(claude)
  await env.writeLiveSession({ pid: claude.pid!, sessionId: '7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e', cwd }, { listed: false })

  claudeforge = await launchClaudeForge(env)
  const explorer = explorerOf('Sessions')

  await expect(explorer.getByRole('heading')).toHaveText(['harbor-api', 'recipe-box'])
  await expect(explorer).not.toContainText('Tidy my aliases')
})

test('starts empty without a list, then lists the first Session started in ClaudeForge, across a restart', async () => {
  await setUp()
  await rm(env.sessionIdsFile)
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })
  const { window } = claudeforge
  const explorer = explorerOf('Sessions')
  await expect(explorer).toContainText('Find every Session you run in ClaudeForge here, grouped by Project.')
  await expect(explorer.getByRole('heading')).toHaveCount(0)

  await window.getByRole('button', { name: 'New Session', exact: true }).click()
  await expect.poll(async () => (await sessionRuns(env)).length).toBe(1)
  await window.keyboard.type('/work 300')
  await window.keyboard.press('Enter')

  await expect(explorer.getByRole('heading')).toHaveText(['dotfiles'])
  await expect(explorer.getByRole('group', { name: 'dotfiles' })).toHaveText(/\/work 300/)

  await claudeforge.close()
  claudeforge = await launchClaudeForge(env, { project: 'dotfiles' })
  await expect(explorerOf('Sessions').getByRole('group', { name: 'dotfiles' })).toHaveText(/\/work 300/)
})

test('warns, with its new place, that an unreadable list was set aside, until dismissed', async () => {
  await setUp()
  await writeFile(env.sessionIdsFile, CORRUPT_LIST)

  claudeforge = await launchClaudeForge(env)
  const explorer = explorerOf('Sessions')
  const warning = explorer.getByRole('alert')

  await expect(warning).toBeVisible()
  await expect(warning).toHaveText(
    `ClaudeForge could not read its list of Sessions, so it started a new one: the Sessions it named are no longer listed. The old list is kept as ${await setAsideFile()}.`
  )
  await expect(explorer.getByRole('heading')).toHaveCount(0)
  await warning.getByRole('button', { name: 'Dismiss' }).click()
  await expect(warning).toHaveCount(0)
})

test('warns in French that an unreadable list was set aside', async () => {
  await setUp({ systemLanguages: ['fr-FR', 'en-US'] })
  await writeFile(env.sessionIdsFile, CORRUPT_LIST)

  claudeforge = await launchClaudeForge(env)
  const warning = explorerOf('Sessions').getByRole('alert')

  await expect(warning).toBeVisible()
  await expect(warning).toHaveText(
    `ClaudeForge n’a pas pu lire sa liste de Sessions et en a commencé une nouvelle : les Sessions qu’elle nommait ne sont plus listées. L’ancienne liste est conservée sous ${await setAsideFile()}.`
  )
  await warning.getByRole('button', { name: 'Fermer' }).click()
  await expect(warning).toHaveCount(0)
})
