import { app, BrowserWindow, session, shell, type WebPreferences } from 'electron'
import { WEB_TAB_PARTITION } from '../shared/api'
import { isWebAddress, webTabUserAgent, whereNewWindowOpens } from '../shared/shortcuts'

/** What a Web tab's page, or a sign-in popup it opened, is given: none of the interface's powers. */
const ISOLATED: WebPreferences = {
  partition: WEB_TAB_PARTITION,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webviewTag: false
}

/**
 * Keeps every Web tab's page apart from the interface (ADR 0006): each `<webview>` the interface
 * attaches loads only a web address, without the preload script and its bridge, sandboxed, in its
 * own persistent storage, under a browser's user agent; a sign-in popup it opens gets the same.
 * Pages get none of the device permissions Electron would otherwise grant them (camera, microphone,
 * location, notifications…): only copying to the clipboard and going full screen.
 */
export function isolateWebTabs(win: BrowserWindow): void {
  // A popup's window sends Electron's fallback user agent whatever its storage's says: set that one.
  app.userAgentFallback = webTabUserAgent(app.userAgentFallback, app.getName())
  const pages = session.fromPartition(WEB_TAB_PARTITION)
  const harmless = new Set(['clipboard-sanitized-write', 'fullscreen'])
  pages.setPermissionRequestHandler((_contents, permission, answer) => answer(harmless.has(permission)))
  pages.setPermissionCheckHandler((_contents, permission) => harmless.has(permission))
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    Object.assign(webPreferences, ISOLATED)
    if (!isWebAddress(params.src ?? '')) event.preventDefault()
  })
}

app.on('web-contents-created', (_event, contents) => {
  // A Web tab's page, or a sign-in popup one opened: the interface's own window is in another storage.
  const isWebTabPage =
    contents.getType() === 'webview' ||
    (contents.getType() === 'window' && contents.session === session.fromPartition(WEB_TAB_PARTITION))
  if (!isWebTabPage) return
  // Links followed inside the page stay where it is. A sign-in popup opens in a ClaudeForge window,
  // still the page's own so it can post back; target=_blank and other new windows go to the default
  // browser. Only http and https ones: a page never has the desktop open a file.
  contents.setWindowOpenHandler(({ url, disposition }) => {
    const place = whereNewWindowOpens(url, disposition)
    if (place === 'browser') void shell.openExternal(url)
    if (place !== 'popup') return { action: 'deny' }
    const parent = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents) ?? undefined
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { parent, webPreferences: { ...ISOLATED, preload: undefined } }
    }
  })
  contents.on('did-create-window', (popup) => popup.removeMenu())
  contents.on('will-navigate', (event, url) => {
    if (!isWebAddress(url)) event.preventDefault()
  })
})
