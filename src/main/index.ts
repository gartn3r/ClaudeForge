import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from 'electron'
import { autoUpdater, type Logger } from 'electron-updater'
import { createBackend, type DesktopShell, type Dialogs, type Updater, type WindowHost } from '../backend'
import { standInRecycleBin, type TrashItem } from '../backend/recycle-bin'
import { CLAUDE_CODE_INSTALLATION_GUIDE } from '../shared/api'
import { bindBackendToIpc } from './ipc'
import { isolateWebTabs } from './web-tabs'

// Test and development overrides. The fake environment sets them all, so Seam 2
// runs against a temporary data folder, a fixed language and a stand-in Recycle Bin.
if (process.env.CLAUDEFORGE_USER_DATA) app.setPath('userData', process.env.CLAUDEFORGE_USER_DATA)

function trashItem(): TrashItem {
  const override = process.env.CLAUDEFORGE_RECYCLE_BIN
  return override ? standInRecycleBin(override) : (path) => shell.trashItem(path)
}

const desktopShell: DesktopShell = {
  openUrl: (url) => shell.openExternal(url),
  openFile: async (path) => {
    // Electron reports a failure to open as a message, not an error.
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
  }
}

function systemLanguages(): string[] {
  const override = process.env.CLAUDEFORGE_SYSTEM_LANGUAGES
  if (override) return override.split(',').map((tag) => tag.trim())
  return app.getPreferredSystemLanguages()
}

/** Where Claude Code keeps its history and live-session registry, as Claude Code itself decides. */
function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

// Windows shows a notification under the app's AppUserModelID: installed, the `appId` the installer
// gives its shortcuts (electron-builder.config.mjs); run from the Electron binary (development,
// tests), the binary's path.
if (process.platform === 'win32')
  app.setAppUserModelId(app.isPackaged ? 'io.github.gartn3r.claudeforge' : process.execPath)

/** Writes how ClaudeForge's updates went to `updates.log` in its logs folder, since an installed app has no console. */
function updateLog(): Logger {
  const write =
    (level: string) =>
    (message?: unknown): void => {
      try {
        mkdirSync(app.getPath('logs'), { recursive: true })
        const line = `${new Date().toISOString()} ${level} ${String(message)}\n`
        appendFileSync(join(app.getPath('logs'), 'updates.log'), line)
      } catch {
        // Logging must never stop an update.
      }
    }
  return { info: write('info'), warn: write('warn'), error: write('error') }
}

/**
 * The installed ClaudeForge updates itself from GitHub releases: the installer writes where to look
 * (`app-update.yml`), and a downloaded update installs once ClaudeForge closes. A development build
 * does not. Tests set `CLAUDEFORGE_UPDATE_FEED` to a release folder served on this machine to update
 * from, or to `none` not to update at all.
 */
function updater(): Updater | undefined {
  const feed = process.env.CLAUDEFORGE_UPDATE_FEED
  const localFeed = feed && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(feed) ? feed : undefined
  if (feed === 'none' || (!localFeed && !app.isPackaged)) return undefined
  autoUpdater.logger = updateLog()
  // Releases carry the full installer, never the web installer that downloads the app.
  autoUpdater.disableWebInstaller = true
  // Without a listener, a failed download would end ClaudeForge; the next check tries again.
  autoUpdater.on('error', (error) => autoUpdater.logger?.error(error.stack ?? error))
  if (localFeed) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL({ provider: 'generic', url: localFeed })
  }
  return {
    check: async () => void (await autoUpdater.checkForUpdates()),
    onDownloaded: (listener) => {
      const onDownloaded = ({ version }: { version: string }): void => listener(version)
      autoUpdater.on('update-downloaded', onDownloaded)
      return () => autoUpdater.off('update-downloaded', onDownloaded)
    }
  }
}

/**
 * The notifications not yet clicked, held so that garbage collection does not drop their click
 * handlers: a toast that left the screen can still be clicked in the notification center.
 */
const shownNotifications = new Set<Notification>()

function windowHost(win: BrowserWindow): WindowHost {
  // Set once the backend has dealt with the user's request to close, so the window really closes.
  let closing = false
  // An interface that hangs cannot warn the user either.
  let hung = false
  win.on('unresponsive', () => (hung = true))
  win.on('responsive', () => (hung = false))
  const onScreen = (): boolean => win.isVisible() && !win.isMinimized()
  return {
    minimize: () => win.minimize(),
    toggleMaximize: () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
    close: () => {
      closing = true
      if (!win.isDestroyed()) win.close()
    },
    onCloseRequest: (listener) => {
      const onClose = (event: Electron.Event): void => {
        // An interface that is gone or hangs cannot warn the user: the window just closes.
        if (closing || hung || win.webContents.isCrashed()) return
        event.preventDefault()
        listener()
      }
      win.on('close', onClose)
      return () => win.off('close', onClose)
    },
    isMaximized: () => win.isMaximized(),
    onMaximizedChange: (listener) => {
      const onMaximize = (): void => listener(true)
      const onUnmaximize = (): void => listener(false)
      win.on('maximize', onMaximize)
      win.on('unmaximize', onUnmaximize)
      return () => {
        win.off('maximize', onMaximize)
        win.off('unmaximize', onUnmaximize)
      }
    },
    isVisible: onScreen,
    onVisibilityChange: (listener) => {
      const onChange = (): void => listener(onScreen())
      win.on('show', onChange)
      win.on('hide', onChange)
      win.on('minimize', onChange)
      win.on('restore', onChange)
      return () => {
        win.off('show', onChange)
        win.off('hide', onChange)
        win.off('minimize', onChange)
        win.off('restore', onChange)
      }
    },
    onFocus: (listener) => {
      win.on('focus', listener)
      return () => win.off('focus', listener)
    },
    notify: ({ title, body }, onClick) => {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title, body })
      shownNotifications.add(notification)
      notification.on('click', () => {
        shownNotifications.delete(notification)
        if (win.isDestroyed()) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        onClick()
      })
      notification.show()
    }
  }
}

function dialogs(win: BrowserWindow): Dialogs {
  return {
    chooseClaudeExecutable: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Claude Code', extensions: ['exe', 'cmd'] }]
      })
      return canceled ? undefined : filePaths[0]
    },
    chooseProjectFolder: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      return canceled ? undefined : filePaths[0]
    }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    title: 'ClaudeForge',
    backgroundColor: '#f5f1e3',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Web tabs show their pages in <webview>s, kept apart from the interface by isolateWebTabs.
      webviewTag: true
    }
  })

  const backend = createBackend({
    stateDir: app.getPath('userData'),
    claudeHome: claudeHome(),
    systemLanguages: systemLanguages(),
    env: process.env,
    window: windowHost(win),
    dialogs: dialogs(win),
    trashItem: trashItem(),
    shell: desktopShell,
    updater: updater()
  })
  const unbind = bindBackendToIpc(backend, ipcMain, win.webContents)
  win.on('closed', () => {
    unbind()
    backend.dispose()
  })

  // The interface never navigates or opens windows of its own; the links it may
  // show open in the default browser.
  const externalLinks = new Set([CLAUDE_CODE_INSTALLATION_GUIDE])
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (externalLinks.has(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  isolateWebTabs(win)

  win.once('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())
