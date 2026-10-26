// The installed ClaudeForge updating itself, from a later release CI builds beside it
// (CLAUDEFORGE_UPDATE_RELEASE: the folder holding its installer and `latest.yml`). It reads that
// folder over HTTP as it reads GitHub releases. Skipped without it, as against a build not installed.

import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { launchClaudeForge, type RunningClaudeForge } from '../seam2/claudeforge'

const EXECUTABLE = process.env.CLAUDEFORGE_EXECUTABLE!
const RELEASE = process.env.CLAUDEFORGE_UPDATE_RELEASE

let env: FakeEnvironment
let server: Server
let claudeforge: RunningClaudeForge | undefined

test.skip(!RELEASE, 'needs a later release to update to (CLAUDEFORGE_UPDATE_RELEASE)')

/** Serves the release folder's files, as GitHub serves a release's assets. */
async function serveRelease(folder: string): Promise<string> {
  server = createServer((request, response) => {
    const file = join(folder, basename(decodeURIComponent(new URL(request.url!, 'http://localhost').pathname)))
    createReadStream(file)
      .on('error', () => response.writeHead(404).end())
      .pipe(response)
  })
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
}

/** The version a ClaudeForge.exe carries, as Windows shows it in its properties (`0.1.0.0` read as `0.1.0`). */
function productVersion(executable: string): string {
  const query = `(Get-Item -LiteralPath '${executable}').VersionInfo.ProductVersion`
  const version = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8' }).trim()
  return version.split('.').slice(0, 3).join('.')
}

test.beforeEach(async () => {
  env = await createFakeEnvironment()
})

test.afterEach(async () => {
  await claudeforge?.close()
  claudeforge = undefined
  server?.close()
  await env.dispose()
})

test('downloads the latest release, says so, and installs it once closed', async () => {
  test.setTimeout(240_000)
  const latest = (await readFile(join(RELEASE!, 'latest.yml'), 'utf8')).match(/^version: (.+)$/m)![1]!.trim()
  const installed = productVersion(EXECUTABLE)
  expect(installed).not.toBe(latest)

  claudeforge = await launchClaudeForge(env, { variables: { CLAUDEFORGE_UPDATE_FEED: await serveRelease(RELEASE!) } })
  const { app, window } = claudeforge

  await expect(window.getByRole('status').filter({ hasText: `Update ${latest} ready` })).toBeVisible({ timeout: 120_000 })
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await window.getByRole('button', { name: 'Close window' }).click()
  await exited
  claudeforge = undefined

  // The installer runs, silently, once ClaudeForge has closed.
  await expect.poll(() => productVersion(EXECUTABLE), { timeout: 120_000, intervals: [2_000] }).toBe(latest)
})
