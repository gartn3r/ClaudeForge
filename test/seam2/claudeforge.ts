import { resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import type { FakeEnvironment, FixtureProject, Invocation } from '../fake-env'

/** The runs of the fake `claude` that started a Session: not the locator's version checks, nor the Extension listings. */
export const sessionRuns = async (env: FakeEnvironment): Promise<Invocation[]> =>
  (await env.invocations('claude')).filter(({ args }) => !['--version', 'mcp', 'plugin'].includes(args[0]!))

const MAIN = resolve(__dirname, '../../out/main/index.js')

export interface RunningClaudeForge {
  app: ElectronApplication
  window: Page
  close(): Promise<void>
}

/** The window size every journey runs at: what the smallest screen we test on (CI's 1024×768) can hold. */
export const WINDOW_SIZE = { width: 1024, height: 768 }

export interface LaunchOptions {
  /** The fixture Project ClaudeForge is started in, the displayed Project until a Session is displayed. */
  project?: FixtureProject
}

/** Launches the built ClaudeForge on a fake environment and waits for its window. */
export async function launchClaudeForge(
  env: FakeEnvironment,
  { project = 'recipe-box' }: LaunchOptions = {}
): Promise<RunningClaudeForge> {
  const app = await electron.launch({ args: [MAIN], env: env.processEnv, cwd: env.projects[project] })
  const window = await app.firstWindow()
  await window.getByRole('main').waitFor()
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width, height })
  }, WINDOW_SIZE)
  await window.waitForFunction((width) => innerWidth === width, WINDOW_SIZE.width)
  return { app, window, close: () => app.close() }
}

/** Makes the next folder dialogs answer as if the user picked this folder. */
export async function pickFolderInDialogs(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
}

/** A Windows notification ClaudeForge raised, as the user reads it. */
export interface ShownNotification {
  title: string
  body: string
}

/**
 * Keeps ClaudeForge's Windows notifications off the screen from now on, recording them instead, for
 * `shownNotifications` to read and `clickNotification` to click.
 */
export async function recordNotifications(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Notification }) => {
    const shown: Electron.Notification[] = []
    Object.assign(globalThis, { recordedNotifications: shown })
    Notification.prototype.show = function (this: Electron.Notification) {
      shown.push(this)
    }
  })
}

/** The notifications ClaudeForge raised since `recordNotifications`, oldest first. */
export const shownNotifications = (app: ElectronApplication): Promise<ShownNotification[]> =>
  app.evaluate(() =>
    (globalThis as unknown as { recordedNotifications: Electron.Notification[] }).recordedNotifications.map(
      ({ title, body }) => ({ title, body })
    )
  )

/** Clicks a notification ClaudeForge raised, as the user would in the Windows notification center. */
export async function clickNotification(app: ElectronApplication, index: number): Promise<void> {
  await app.evaluate((_electron, index) => {
    const shown = (globalThis as unknown as { recordedNotifications: Electron.Notification[] }).recordedNotifications
    shown[index]!.emit('click')
  }, index)
}
