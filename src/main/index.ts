import { join } from 'node:path'
import { BrowserWindow, app, ipcMain } from 'electron'
import { createBackend, type WindowHost } from '../backend'
import { bindBackendToIpc } from './ipc'

// Test and development overrides. The fake environment sets both, so Seam 2
// runs against a temporary data folder and a fixed language.
if (process.env.CLAUDEFORGE_USER_DATA) app.setPath('userData', process.env.CLAUDEFORGE_USER_DATA)

function systemLanguages(): string[] {
  const override = process.env.CLAUDEFORGE_SYSTEM_LANGUAGES
  if (override) return override.split(',').map((tag) => tag.trim())
  return app.getPreferredSystemLanguages()
}

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
    systemLanguages: systemLanguages(),
    window: windowHost(win)
  })
  const unbind = bindBackendToIpc(backend, ipcMain, win.webContents)
  win.on('closed', () => {
    unbind()
    backend.dispose()
  })

  // The interface never navigates or opens windows of its own.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  win.once('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())
