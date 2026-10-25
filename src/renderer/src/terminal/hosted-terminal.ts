import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { HostedSession } from '../../../shared/api'
import { api, onEvent } from '../api'

/** How long the terminal's area must keep its size before the terminal refits, so a drag resizes `claude` once. */
const REFIT_DELAY_MS = 50

/** How a Hosted session ended: `claude`'s exit code, or null when it could not start. */
export type SessionEnd = { exitCode: number | null }

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()

/** The design system's terminal theme, read from its tokens. */
function terminalTheme(): ITheme {
  return {
    background: token('terminal-well'),
    foreground: token('text'),
    cursor: token('brass'),
    cursorAccent: token('terminal-well'),
    selectionBackground: token('selection'),
    black: token('ansi-black'),
    red: token('ansi-red'),
    green: token('ansi-green'),
    yellow: token('ansi-yellow'),
    blue: token('ansi-blue'),
    magenta: token('ansi-magenta'),
    cyan: token('ansi-cyan'),
    white: token('ansi-white'),
    brightBlack: token('ansi-bright-black'),
    brightRed: token('ansi-bright-red'),
    brightGreen: token('ansi-bright-green'),
    brightYellow: token('ansi-bright-yellow'),
    brightBlue: token('ansi-bright-blue'),
    brightMagenta: token('ansi-bright-magenta'),
    brightCyan: token('ansi-bright-cyan'),
    brightWhite: token('ansi-bright-white')
  }
}

/**
 * One Hosted session's terminal: xterm.js wired to its `claude` through the
 * Session host. It outlives the component showing it, so it can be shown
 * again elsewhere without restarting anything.
 */
export class HostedTerminal {
  private readonly terminal: Terminal
  private readonly fit = new FitAddon()
  private webgl: WebglAddon | undefined
  private session: HostedSession | undefined
  /** Events that arrived before the Session host said which Hosted session is this one. */
  private early: Array<{ id: string; apply(): void }> = []
  private end: SessionEnd | undefined
  private readonly endListeners = new Set<(end: SessionEnd) => void>()
  private readonly unsubscribers: Array<() => void>
  private container: HTMLElement | undefined
  private opened = false
  private disposed = false
  private refitTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    readonly project: string,
    private gpuRendering: boolean
  ) {
    this.terminal = new Terminal({
      // The mono-terminal text style.
      fontFamily: token('font-mono'),
      fontSize: 13,
      lineHeight: 1.3,
      fontWeight: 400,
      fontWeightBold: 600,
      theme: terminalTheme(),
      allowProposedApi: true
    })
    this.terminal.loadAddon(this.fit)
    this.terminal.loadAddon(new Unicode11Addon())
    this.terminal.unicode.activeVersion = '11'

    // Claude Code on Windows cannot tell Shift+Enter from Enter, so Shift+Enter sends
    // Ctrl+J, which inserts a newline in its prompt in every terminal.
    this.terminal.attachCustomKeyEventHandler((event) => {
      const shiftEnter = event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      if (!shiftEnter) return true
      if (event.type === 'keydown') this.write('\n')
      return false
    })
    this.terminal.onData((data) => this.write(data))
    this.terminal.onResize(({ cols, rows }) => {
      if (this.session) void api.sessionHost.resize(this.session.id, { cols, rows })
    })

    this.unsubscribers = [
      onEvent('sessionHost.output', ({ id, data }) => this.receive(id, () => this.terminal.write(data))),
      onEvent('sessionHost.exit', ({ id, exitCode }) => this.receive(id, () => this.finish({ exitCode })))
    ]
  }

  /**
   * Shows the terminal in a container and keeps it fitted there; the first
   * time, starts `claude` at the size that fits. Returns a function that stops
   * following the container's size.
   */
  attach(container: HTMLElement): () => void {
    this.container = container
    if (!this.opened) {
      this.opened = true
      void this.open()
    } else if (this.terminal.element && this.terminal.element.parentElement !== container) {
      container.append(this.terminal.element)
      this.terminal.focus()
    }
    const observer = new ResizeObserver(() => {
      clearTimeout(this.refitTimer)
      this.refitTimer = setTimeout(() => this.fit.fit(), REFIT_DELAY_MS)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      clearTimeout(this.refitTimer)
    }
  }

  /** Switches between the WebGL renderer and the DOM renderer. */
  setGpuRendering(on: boolean): void {
    this.gpuRendering = on
    if (!this.terminal.element) return
    if (on) this.loadWebgl()
    else this.unloadWebgl()
  }

  /** Calls back once the Hosted session has ended, at once if it already has; returns an unsubscribe. */
  onEnd(listener: (end: SessionEnd) => void): () => void {
    if (this.end) listener(this.end)
    else this.endListeners.add(listener)
    return () => this.endListeners.delete(listener)
  }

  /** Stops `claude` if it still runs, and lets go of the terminal. */
  dispose(): void {
    this.disposed = true
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    if (this.session && !this.end) void api.sessionHost.stop(this.session.id)
    clearTimeout(this.refitTimer)
    this.terminal.dispose()
  }

  private async open(): Promise<void> {
    // xterm.js measures its cells once, so the bundled font must be ready first.
    const font = token('font-mono')
    await Promise.all([document.fonts.load(`400 13px ${font}`), document.fonts.load(`600 13px ${font}`)])
    if (this.disposed) return
    this.terminal.open(this.container!)
    if (this.gpuRendering) this.loadWebgl()
    this.fit.fit()
    try {
      this.session = await api.sessionHost.start(this.project, { cols: this.terminal.cols, rows: this.terminal.rows })
    } catch {
      this.early = []
      this.finish({ exitCode: null })
      return
    }
    // Let go of a `claude` started for a terminal that was closed in the meantime.
    if (this.disposed) return void api.sessionHost.stop(this.session.id)
    this.terminal.options.windowsPty = this.session.windowsPty ?? undefined
    const id = this.session.id
    for (const event of this.early.splice(0)) if (event.id === id) event.apply()
    this.terminal.focus()
  }

  private receive(id: string, apply: () => void): void {
    if (!this.session) this.early.push({ id, apply })
    else if (id === this.session.id) apply()
  }

  private write(data: string): void {
    if (this.session && !this.end) void api.sessionHost.write(this.session.id, data)
  }

  private finish(end: SessionEnd): void {
    this.end = end
    for (const listener of this.endListeners) listener(end)
    this.endListeners.clear()
  }

  private loadWebgl(): void {
    if (this.webgl) return
    try {
      const webgl = new WebglAddon()
      // A lost context (driver reset, too many contexts) falls back to the DOM renderer.
      webgl.onContextLoss(() => this.unloadWebgl())
      this.terminal.loadAddon(webgl)
      this.webgl = webgl
    } catch {
      // No WebGL2 here: the DOM renderer stays.
    }
  }

  private unloadWebgl(): void {
    this.webgl?.dispose()
    this.webgl = undefined
  }
}
