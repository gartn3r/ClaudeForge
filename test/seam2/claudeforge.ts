import { resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import type { FakeEnvironment } from '../fake-env'

const MAIN = resolve(__dirname, '../../out/main/index.js')

export interface RunningClaudeForge {
  app: ElectronApplication
  window: Page
  close(): Promise<void>
}

/** The window size every journey runs at: what the smallest screen we test on (CI's 1024×768) can hold. */
export const WINDOW_SIZE = { width: 1024, height: 768 }

/** Launches the built ClaudeForge on a fake environment and waits for its window. */
export async function launchClaudeForge(env: FakeEnvironment): Promise<RunningClaudeForge> {
  const app = await electron.launch({ args: [MAIN], env: env.processEnv })
  const window = await app.firstWindow()
  await window.getByRole('main').waitFor()
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width, height })
  }, WINDOW_SIZE)
  await window.waitForFunction((width) => innerWidth === width, WINDOW_SIZE.width)
  return { app, window, close: () => app.close() }
}
