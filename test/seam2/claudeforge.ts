import { resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import type { FakeEnvironment } from '../fake-env'

const MAIN = resolve(__dirname, '../../out/main/index.js')

export interface RunningClaudeForge {
  app: ElectronApplication
  window: Page
  close(): Promise<void>
}

/** Launches the built ClaudeForge on a fake environment and waits for its window. */
export async function launchClaudeForge(env: FakeEnvironment): Promise<RunningClaudeForge> {
  const app = await electron.launch({ args: [MAIN], env: env.processEnv })
  const window = await app.firstWindow()
  await window.getByRole('main').waitFor()
  return { app, window, close: () => app.close() }
}
