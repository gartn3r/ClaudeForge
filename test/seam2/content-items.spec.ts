import type { Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { inWebTab, launchClaudeForge, serveFixturePages, type RunningClaudeForge } from './claudeforge'
import { addContent, createPanelTab } from './panel-tabs'

let env: FakeEnvironment
let claudeforge: RunningClaudeForge | undefined
let pages: { origin: string; server: Server }

test.beforeEach(async () => {
  env = await createFakeEnvironment()
  pages = await serveFixturePages()
})

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  await env.dispose()
  pages.server.close()
})

test('a web page Content item runs apart from the interface and cannot reach its bridge', async () => {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  await createPanelTab(window, 'Dev', 'dev')
  await addContent(window, 'Dev', 'Web page', { Address: `${pages.origin}/` })

  await expect.poll(() => inWebTab(app, 'document.title')).toBe('Fixture dev server')
  expect(await inWebTab(app, 'typeof window.claudeforge')).toBe('undefined')
  expect(await inWebTab(app, 'typeof require')).toBe('undefined')
  // Its storage is the Web tabs', never the interface's.
  expect(await inWebTab(app, 'document.cookie')).toBe('visited=first')
  expect(await window.evaluate(() => document.cookie)).toBe('')
})
