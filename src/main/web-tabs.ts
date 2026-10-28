import { app, session, shell, type BrowserWindow } from 'electron'
import { WEB_TAB_PARTITION } from '../shared/api'
import { isWebAddress } from '../shared/shortcuts'

/**
 * Keeps every Web tab's page apart from the interface (ADR 0006): each `<webview>` the interface
 * attaches loads only a web address, without the preload script and its bridge, sandboxed, in its
 * own persistent storage; every new window a page asks for opens in the default browser instead.
 * Pages get none of the device permissions Electron would otherwise grant them (camera, microphone,
 * location, notifications…): only copying to the clipboard and going full screen.
 */
export function isolateWebTabs(win: BrowserWindow): void {
  const pages = session.fromPartition(WEB_TAB_PARTITION)
  const harmless = new Set(['clipboard-sanitized-write', 'fullscreen'])
  pages.setPermissionRequestHandler((_contents, permission, answer) => answer(harmless.has(permission)))
  pages.setPermissionCheckHandler((_contents, permission) => harmless.has(permission))
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webviewTag = false
    webPreferences.partition = WEB_TAB_PARTITION
    if (!isWebAddress(params.src ?? '')) event.preventDefault()
  })
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  // Links followed inside the page stay in its Web tab; target=_blank, window.open and sign-in popups
  // go to the default browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebAddress(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isWebAddress(url)) event.preventDefault()
  })
})
