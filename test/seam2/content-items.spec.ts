import type { Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { WEB_TAB_PARTITION } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { inWebTab, launchClaudeForge, serveFixturePages, type RunningClaudeForge } from './claudeforge'

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

// No window shows a web page Content item yet (the Right panel comes with #60), so the journey
// attaches the `<webview>` the Content item view renders, with the same attributes, as it will.
test('a web page Content item runs apart from the interface and cannot reach its bridge', async () => {
  claudeforge = await launchClaudeForge(env)
  const { app, window } = claudeforge
  await window.evaluate(
    ({ src, partition }) => {
      const page = document.createElement('webview')
      page.className = 'content-item__page'
      page.setAttribute('src', src)
      page.setAttribute('partition', partition)
      document.body.append(page)
    },
    { src: `${pages.origin}/`, partition: WEB_TAB_PARTITION }
  )

  await expect.poll(() => inWebTab(app, 'document.title')).toBe('Fixture dev server')
  expect(await inWebTab(app, 'typeof window.claudeforge')).toBe('undefined')
  expect(await inWebTab(app, 'typeof require')).toBe('undefined')
  // Its storage is the Web tabs', never the interface's.
  expect(await inWebTab(app, 'document.cookie')).toBe('visited=first')
  expect(await window.evaluate(() => document.cookie)).toBe('')
})
