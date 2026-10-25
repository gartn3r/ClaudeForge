import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from 'electron'
import { createBackend, type Dialogs, type WindowHost } from '../backend'
import { standInRecycleBin, type TrashItem } from '../backend/recycle-bin'
import { CLAUDE_CODE_INSTALLATION_GUIDE } from '../shared/api'
import { bindBackendToIpc } from './ipc'

// Test and development overrides. The fake environment sets them all, so Seam 2
// runs against a temporary data folder, a fixed language and a stand-in Recycle Bin.
if (process.env.CLAUDEFORGE_USER_DATA) app.setPath('userData', process.env.CLAUDEFORGE_USER_DATA)

function trashItem(): TrashItem {
  const override = process.env.CLAUDEFORGE_RECYCLE_BIN
  return override ? standInRecycleBin(override) : (path) => shell.trashItem(path)
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

// Windows shows a notification under the app's AppUserModelID; run from the Electron binary
// (development, tests), that is the binary's path.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'ClaudeForge' : process.execPath)

/** The notifications on screen, held so that garbage collection does not drop their click handlers. */
const shownNotifications = new Set<Notification>()

function windowHost(win: BrowserWindow): WindowHost {
  return {
    minimize: () => win.minimize(),
    toggleMaximize: () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
    close: () => win.close(),
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
    notify: ({ title, body }, onClick) => {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title, body })
      shownNotifications.add(notification)
      notification.on('close', () => shownNotifications.delete(notification))
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
    backgroundColor: '#0f141b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  const backend = createBackend({
    stateDir: app.getPath('userData'),
    claudeHome: claudeHome(),
    systemLanguages: systemLanguages(),
    env: process.env,
    window: windowHost(win),
    dialogs: dialogs(win),
    trashItem: trashItem()
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

  win.once('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())
