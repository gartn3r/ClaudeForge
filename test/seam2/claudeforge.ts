import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { CLI_INSTRUCTION } from '../../src/backend/cli-channel'
import type { FakeEnvironment, FixtureProject, Invocation } from '../fake-env'

/** The runs of the fake `claude` that started a Session: not the locator's version checks, nor the Extension listings. */
export const sessionRuns = async (env: FakeEnvironment): Promise<Invocation[]> =>
  (await env.invocations('claude')).filter(({ args }) => !['--version', 'mcp', 'plugin'].includes(args[0]!))

/** The options every Hosted session's `claude` ends with, telling it about the ClaudeForge CLI. */
export const TOLD_ABOUT_THE_CLI = ['--append-system-prompt', CLI_INSTRUCTION] as const

const MAIN = resolve(__dirname, '../../out/main/index.js')

/**
 * A packaged ClaudeForge's `ClaudeForge.exe`, installed or not, to run the journeys against instead
 * of the build in out/ (`npm run test:packaged`).
 */
const PACKAGED = process.env.CLAUDEFORGE_EXECUTABLE

export interface RunningClaudeForge {
  app: ElectronApplication
  window: Page
  /** Ends ClaudeForge without asking, even with a Session working; a journey drives the user's own close itself. */
  close(): Promise<void>
}

/** The window size every journey runs at: what the smallest screen we test on (CI's 1024×768) can hold. */
export const WINDOW_SIZE = { width: 1024, height: 768 }

export interface LaunchOptions {
  /** The fixture Project ClaudeForge is started in, the displayed Project until a Session is displayed. */
  project?: FixtureProject
  /** Variables set on top of the fake environment's. */
  variables?: Record<string, string>
}

/** Launches the built (or packaged) ClaudeForge on a fake environment and waits for its window. */
export async function launchClaudeForge(
  env: FakeEnvironment,
  { project = 'recipe-box', variables }: LaunchOptions = {}
): Promise<RunningClaudeForge> {
  const launch = PACKAGED ? { executablePath: PACKAGED } : { args: [MAIN] }
  const app = await electron.launch({ ...launch, env: { ...env.processEnv, ...variables }, cwd: env.projects[project] })
  const window = await app.firstWindow()
  await window.getByRole('main').waitFor()
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 0, y: 0, width, height })
  }, WINDOW_SIZE)
  await window.waitForFunction((width) => innerWidth === width, WINDOW_SIZE.width)
  return { app, window, close: () => quit(app) }
}

/**
 * Ends ClaudeForge as if its window were gone: closing it asks first while a Session works, and
 * Playwright's own close would wait for that forever.
 */
async function quit(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
    })
    // ClaudeForge may have closed already.
    .catch(() => undefined)
  await app.close()
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

const FIXTURE_PAGES = resolve(__dirname, '../fixtures/web')

/** Serves test/fixtures/web on this machine, as a Project's dev server would. */
export async function serveFixturePages(): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    readFile(join(FIXTURE_PAGES, path === '/' ? 'index.html' : path)).then(
      (page) => response.writeHead(200, { 'content-type': 'text/html' }).end(page),
      () => response.writeHead(404).end()
    )
  })
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  return { origin: `http://localhost:${(server.address() as AddressInfo).port}`, server }
}

/** Runs a script in the Web tab's page, from the main process, as a user gesture; null with no Web tab. */
export const inWebTab = (app: ElectronApplication, script: string): Promise<unknown> =>
  app.evaluate(async ({ webContents }, script) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
    return page ? page.executeJavaScript(script, true) : null
  }, script)
