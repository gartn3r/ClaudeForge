import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { HostedSession, HostedSessionStatus } from '../../../shared/api'
import { api, onEvent } from '../api'

/** How long the terminal's area must keep its size before the terminal refits, so a drag resizes `claude` once. */
const REFIT_DELAY_MS = 50

/** How a Hosted session ended: `claude`'s exit code, or null when it could not start. */
export type SessionEnd = { exitCode: number | null }

/** Claude Code puts a spinner or status glyph before the name it gives its terminal. */
const STATUS_GLYPH = /^\p{So}\s+/u

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
 * Session host. It lives outside React, so a component re-mounting (as React's
 * strict mode does) never starts `claude` twice, and a hidden terminal keeps
 * its `claude` and its scrollback.
 */
export class HostedTerminal {
  private readonly terminal: Terminal
  private readonly fit = new FitAddon()
  private webgl: WebglAddon | undefined
  private session: HostedSession | undefined
  /** Events that arrived before the Session host said which Hosted session is this one. */
  private eventsBeforeStart: Array<{ id: string; apply(): void }> = []
  private ended: SessionEnd | undefined
  private readonly endListeners = new Set<(end: SessionEnd) => void>()
  private readonly changeListeners = new Set<() => void>()
  private currentStatus: HostedSessionStatus = 'idle'
  private currentTitle: string | null = null
  /** Whether the terminal is on show; only then does it hold a WebGL context, as Chromium caps them. */
  private visible = true
  private readonly unsubscribers: Array<() => void>
  private container: HTMLElement | undefined
  private opened = false
  private disposed = false
  private refitTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly project: string,
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
    this.terminal.onTitleChange((title) => {
      this.currentTitle = title.replace(STATUS_GLYPH, '').trim() || null
      this.changed()
    })

    this.unsubscribers = [
      onEvent('sessionHost.output', ({ id, data }) => this.handleEvent(id, () => this.terminal.write(data))),
      onEvent('sessionHost.exit', ({ id, exitCode }) => this.handleEvent(id, () => this.finish({ exitCode }))),
      onEvent('sessionHost.status', ({ id, status }) =>
        this.handleEvent(id, () => {
          this.currentStatus = status
          this.changed()
        })
      )
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
    }
    const observer = new ResizeObserver(() => {
      if (!this.visible) return
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
    this.updateRenderer()
  }

  /** Shows the terminal, refitted and focused, or hides it; a hidden one gives up its WebGL context. */
  setVisible(visible: boolean): void {
    this.visible = visible
    this.updateRenderer()
    if (visible && this.terminal.element) {
      this.fit.fit()
      this.terminal.focus()
    }
  }

  focus(): void {
    this.terminal.focus()
  }

  /** What `claude` is doing, as the Session host last said. */
  get status(): HostedSessionStatus {
    return this.currentStatus
  }

  /** The name Claude Code gave its terminal, without its status glyph; null until it gives one. */
  get title(): string | null {
    return this.currentTitle
  }

  /** How the Hosted session ended; undefined while it runs. */
  get end(): SessionEnd | undefined {
    return this.ended
  }

  /** Calls back once the Hosted session has ended, at once if it already has; returns an unsubscribe. */
  onEnd(listener: (end: SessionEnd) => void): () => void {
    if (this.ended) listener(this.ended)
    else this.endListeners.add(listener)
    return () => this.endListeners.delete(listener)
  }

  /** Calls back whenever its status, title or end changes; returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  /** Stops `claude` if it still runs, and lets go of the terminal. */
  dispose(): void {
    this.disposed = true
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    if (this.session && !this.ended) void api.sessionHost.stop(this.session.id)
    clearTimeout(this.refitTimer)
    this.changeListeners.clear()
    this.unloadWebgl()
    this.terminal.dispose()
  }

  private async open(): Promise<void> {
    // xterm.js measures its cells once, so the bundled font must be ready first.
    const font = token('font-mono')
    await Promise.all([document.fonts.load(`400 13px ${font}`), document.fonts.load(`600 13px ${font}`)])
    if (this.disposed) return
    this.terminal.open(this.container!)
    this.updateRenderer()
    this.fit.fit()
    const { cols, rows } = this.terminal
    try {
      this.session = await api.sessionHost.start(this.project, { cols, rows })
    } catch {
      this.eventsBeforeStart = []
      this.finish({ exitCode: null })
      return
    }
    // Let go of a `claude` started for a terminal that was closed in the meantime.
    if (this.disposed) return void api.sessionHost.stop(this.session.id)
    this.terminal.options.windowsPty = this.session.windowsPty ?? undefined
    const id = this.session.id
    // A refit while `claude` was starting could not reach it yet.
    if (this.terminal.cols !== cols || this.terminal.rows !== rows) {
      void api.sessionHost.resize(id, { cols: this.terminal.cols, rows: this.terminal.rows })
    }
    for (const event of this.eventsBeforeStart.splice(0)) if (event.id === id) event.apply()
    if (this.visible) this.terminal.focus()
  }

  /** Applies a Session host event if it is this Hosted session's, holding it back until `claude` has started. */
  private handleEvent(id: string, apply: () => void): void {
    if (!this.session) this.eventsBeforeStart.push({ id, apply })
    else if (id === this.session.id) apply()
  }

  private write(data: string): void {
    if (this.session && !this.ended) void api.sessionHost.write(this.session.id, data)
  }

  private finish(end: SessionEnd): void {
    this.ended = end
    for (const listener of this.endListeners) listener(end)
    this.endListeners.clear()
    this.changed()
  }

  private changed(): void {
    for (const listener of this.changeListeners) listener()
  }

  /** WebGL while the terminal is on show and GPU rendering is on, else the DOM renderer. */
  private updateRenderer(): void {
    if (!this.terminal.element) return
    if (this.visible && this.gpuRendering) this.loadWebgl()
    else this.unloadWebgl()
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
    const webgl = this.webgl
    if (!webgl) return
    this.webgl = undefined
    // Disposing the addon leaves its WebGL context alive until garbage collection, and past
    // Chromium's cap a live terminal loses its renderer (xterm.js#6068), so let go of it now.
    for (const canvas of this.terminal.element?.querySelectorAll('canvas') ?? []) {
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
    }
    webgl.dispose()
  }
}
