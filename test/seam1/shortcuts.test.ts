import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backend, DesktopShell } from '../../src/backend'
import type { Shortcut } from '../../src/shared/api'
import {
  commandText,
  isPopupAddress,
  isWebAddress,
  opensInBrowser,
  shortcutProblems,
  webTabUserAgent,
  whereNewWindowOpens
} from '../../src/shared/shortcuts'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const devServer: Shortcut = { id: 'dev', name: 'Dev server', kind: 'web', address: 'http://localhost:5173/' }
const issues: Shortcut = { id: 'issues', name: 'Repo issues', kind: 'web', address: 'https://github.com/fixture/harbor-api/issues' }
const wayfinder: Shortcut = {
  id: 'map',
  name: 'Move the Map on',
  kind: 'skill',
  command: { mode: 'skill', skill: 'wayfinder', args: '#14' }
}
const review: Shortcut = { id: 'review', name: 'Review', kind: 'skill', command: { mode: 'free', text: '/review --deep' } }

describe('Shortcuts', () => {
  let env: FakeEnvironment
  const backends: Backend[] = []

  const start = (shell?: DesktopShell): Backend => {
    const backend = startBackend(env, undefined, undefined, shell)
    backends.push(backend)
    return backend
  }

  beforeEach(async () => {
    env = await createFakeEnvironment()
  })

  afterEach(async () => {
    for (const backend of backends.splice(0)) backend.dispose()
    await env.dispose()
  })

  it('starts with no Shortcut, then keeps those added, in order, across a restart', async () => {
    expect((await start().api.appState.read()).shortcuts).toEqual([])

    await start().api.appState.write({ shortcuts: [wayfinder, devServer] })
    await start().api.appState.write({ shortcuts: [wayfinder, devServer, review] })

    expect((await start().api.appState.read()).shortcuts).toEqual([wayfinder, devServer, review])
  })

  it('edits, deletes and reorders Shortcuts with each write of the list', async () => {
    const { api } = start()
    await api.appState.write({ shortcuts: [wayfinder, devServer, review] })

    const edited = await api.appState.write({
      shortcuts: [{ ...wayfinder, name: 'Next Ticket', command: { mode: 'skill', skill: 'wayfinder', args: '' } }, devServer, review]
    })
    expect(edited.shortcuts[0]).toEqual({ ...wayfinder, name: 'Next Ticket', command: { mode: 'skill', skill: 'wayfinder', args: '' } })

    const deleted = await api.appState.write({ shortcuts: [edited.shortcuts[0]!, review] })
    expect(deleted.shortcuts.map(({ id }) => id)).toEqual(['map', 'review'])

    const reordered = await api.appState.write({ shortcuts: [review, edited.shortcuts[0]!] })
    expect(reordered.shortcuts.map(({ id }) => id)).toEqual(['review', 'map'])
    expect((await start().api.appState.read()).shortcuts.map(({ id }) => id)).toEqual(['review', 'map'])
  })

  it('leaves out the Shortcuts the form would refuse, and trims the others', async () => {
    const written = await start().api.appState.write({
      shortcuts: [
        { ...devServer, id: 'nameless', name: '   ' },
        { ...devServer, id: 'ftp', address: 'ftp://example.com/file' },
        { ...devServer, id: 'script', address: 'javascript:alert(1)' },
        { ...devServer, id: 'relative', address: 'localhost:5173' },
        { ...review, id: 'quote', command: { mode: 'free', text: '/review "deep"' } },
        { ...review, id: 'percent', command: { mode: 'free', text: '/review 100%' } },
        { ...review, id: 'break', command: { mode: 'free', text: '/review\n--deep' } },
        { ...wayfinder, id: 'quoted-args', command: { mode: 'skill', skill: 'wayfinder', args: '"#14"' } },
        { ...wayfinder, id: 'no-skill', command: { mode: 'skill', skill: '', args: '#14' } },
        { ...review, id: 'empty', command: { mode: 'free', text: '  ' } },
        { id: 'odd', name: 'Odd', kind: 'folder', address: 'C:\\' },
        'not a Shortcut',
        { ...issues, name: '  Repo issues  ', address: ' https://github.com/fixture/harbor-api/issues ' },
        { ...issues, name: 'Taken id' }
      ]
    } as never)

    expect(written.shortcuts).toEqual([issues])
  })

  it('accepts http, https, localhost and file addresses, and refuses any other scheme', () => {
    for (const address of ['http://example.com', 'https://example.com/a?b#c', 'http://localhost:3000', 'https://127.0.0.1:8443', 'file:///C:/reports/index.html']) {
      expect(isWebAddress(address), address).toBe(true)
    }
    for (const address of ['ftp://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:me@example.com', 'localhost:3000', 'example.com', '']) {
      expect(isWebAddress(address), address).toBe(false)
    }
  })

  it('says what the form refuses, and types a skill with its arguments', () => {
    expect(shortcutProblems({ ...devServer, name: '' })).toEqual(['name-missing'])
    expect(shortcutProblems({ ...devServer, address: 'ftp://x' })).toEqual(['address-invalid'])
    expect(shortcutProblems({ ...review, command: { mode: 'free', text: '' } })).toEqual(['command-missing'])
    expect(shortcutProblems({ ...review, command: { mode: 'free', text: 'a "b"' } })).toEqual(['command-forbidden'])
    expect(shortcutProblems({ ...wayfinder, command: { mode: 'skill', skill: 'wayfinder', args: '50%' } })).toEqual(['command-forbidden'])
    expect(shortcutProblems(wayfinder)).toEqual([])

    expect(commandText(wayfinder.kind === 'skill' ? wayfinder.command : review.command)).toBe('/wayfinder #14')
    expect(commandText({ mode: 'skill', skill: 'frontend-design:ui-polish', args: '  ' })).toBe('/frontend-design:ui-polish')
    expect(commandText({ mode: 'free', text: ' /clear ' })).toBe('/clear')
  })

  it('keeps the open Web tabs, in order, across a restart', async () => {
    expect((await start().api.appState.read()).webTabs).toEqual([])

    await start().api.appState.write({ shortcuts: [devServer, wayfinder, issues] })
    await start().api.appState.write({ webTabs: ['issues', 'dev'] })

    expect((await start().api.appState.read()).webTabs).toEqual(['issues', 'dev'])
  })

  it('restores only Web tabs whose Web shortcut is still there', async () => {
    const { api } = start()
    await api.appState.write({ shortcuts: [devServer, wayfinder, issues] })

    const written = await api.appState.write({ webTabs: ['dev', 'map', 'gone', 'dev', 'issues'] })
    expect(written.webTabs).toEqual(['dev', 'issues'])

    // Deleting a Web shortcut closes its Web tab; one that becomes a Skill shortcut closes its too.
    const deleted = await api.appState.write({ shortcuts: [devServer, wayfinder, { ...review, id: 'issues' }] })
    expect(deleted.webTabs).toEqual(['dev'])
    expect((await start().api.appState.read()).webTabs).toEqual(['dev'])
  })

  it('opens a Web tab in the default browser, and refuses anything but a web page', async () => {
    const opened: string[] = []
    const { api } = start({ openUrl: async (url) => void opened.push(url), openFile: async () => undefined })

    await api.web.openInBrowser('http://localhost:5173/pricing')
    await api.web.openInBrowser('file:///C:/reports/index.html')
    await expect(api.web.openInBrowser('C:\\Windows\\System32\\calc.exe')).rejects.toThrow()
    // Windows would run a program a file address names, rather than show it in a browser.
    await expect(api.web.openInBrowser('file:///C:/Windows/System32/calc.exe')).rejects.toThrow()
    await expect(api.web.openInBrowser('ms-settings:privacy')).rejects.toThrow()

    expect(opened).toEqual(['http://localhost:5173/pricing', 'file:///C:/reports/index.html'])
  })

  it('hands the default browser only web pages, and a page only http or https new windows', () => {
    expect(opensInBrowser('https://example.com/a')).toBe(true)
    expect(opensInBrowser('file:///C:/reports/index.HTM')).toBe(true)
    expect(opensInBrowser('file:///C:/Users/me/setup.bat')).toBe(false)
    expect(isPopupAddress('https://accounts.example.com/sign-in')).toBe(true)
    expect(isPopupAddress('http://localhost:3000/help')).toBe(true)
    expect(isPopupAddress('file:///C:/reports/index.html')).toBe(false)
    expect(isPopupAddress('file:///C:/Windows/System32/calc.exe')).toBe(false)
  })

  it("opens a page's sign-in popup in a ClaudeForge window, its other new windows in the default browser", () => {
    expect(whereNewWindowOpens('https://accounts.google.com/gsi/select', 'new-window')).toBe('popup')
    expect(whereNewWindowOpens('http://localhost:3000/sign-in', 'new-window')).toBe('popup')
    expect(whereNewWindowOpens('https://example.com/docs', 'foreground-tab')).toBe('browser')
    expect(whereNewWindowOpens('https://example.com/docs', 'background-tab')).toBe('browser')
    expect(whereNewWindowOpens('https://example.com/docs', 'other')).toBe('browser')
    // A page never has the desktop open a file, which could be a program, in a window or in the browser.
    expect(whereNewWindowOpens('file:///C:/reports/index.html', 'new-window')).toBe('nowhere')
    expect(whereNewWindowOpens('file:///C:/Windows/System32/calc.exe', 'foreground-tab')).toBe('nowhere')
    expect(whereNewWindowOpens('about:blank', 'new-window')).toBe('nowhere')
  })

  it("gives Web tabs a browser's user agent, without Electron's and ClaudeForge's tokens", () => {
    const electron =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ClaudeForge/0.1.0 Chrome/140.0.7339.41 Electron/45.0.0 Safari/537.36'
    const browser =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36'
    expect(webTabUserAgent(electron, 'ClaudeForge')).toBe(browser)
    expect(webTabUserAgent(electron.replace('ClaudeForge/', 'claudeforge/'), 'ClaudeForge')).toBe(browser)
    expect(webTabUserAgent(browser, 'ClaudeForge')).toBe(browser)
  })
})
