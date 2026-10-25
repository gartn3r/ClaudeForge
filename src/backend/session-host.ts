import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { extname } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { HostedSession, HostedSessionStatus, TerminalSize } from '../shared/api'
import { envVar, type Environment } from './claude-code'

/** What every Hosted session's `claude` gets on top of ClaudeForge's own environment. */
const HOSTED_ENVIRONMENT: Environment = {
  // ConPTY coalesces Claude Code's positioned writes wrongly; full repaints leave no fragments behind.
  CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1',
  // xterm.js supports synchronized output, but Claude Code's probe settles too late in a terminal it does not know.
  CLAUDE_CODE_FORCE_SYNC_OUTPUT: '1',
  TERM_PROGRAM: 'ClaudeForge',
  // Describes the terminal ClaudeForge was started from, not this one.
  TERM_PROGRAM_VERSION: undefined
}

/** The environment with the given variables set or removed, whatever case it spells them in. */
function withVariables(env: Environment, variables: Environment): Environment {
  const names = new Set(Object.keys(variables).map((name) => name.toUpperCase()))
  const result = Object.fromEntries(Object.entries(env).filter(([name]) => !names.has(name.toUpperCase())))
  for (const [name, value] of Object.entries(variables)) if (value !== undefined) result[name] = value
  return result
}

/** Output this soon after the user typed or the terminal resized is `claude` redrawing its screen, not working. */
const REDRAW_MS = 250
/** How long `claude` must stay quiet, after the user sent a prompt or after working, before its turn counts as over. */
const QUIET_MS = 1500

/** One running `claude`, with what its output says it is doing. */
interface HostedProcess {
  id: string
  pty: IPty
  status: HostedSessionStatus
  /** When the user last typed into it or resized it, in ms since the epoch. */
  touchedAt: number
  /** Whether the user sent a prompt (Enter) and `claude` has not fallen quiet since: only then can it work. */
  inTurn: boolean
  /** Ends the turn once `claude` stays quiet. */
  quietTimer?: ReturnType<typeof setTimeout>
}

const windowsPty = (): HostedSession['windowsPty'] =>
  process.platform === 'win32' ? { backend: 'conpty', buildNumber: Number(release().split('.')[2]) } : null

export interface SessionHostOptions {
  /** ClaudeForge's environment, which `claude` inherits. */
  env: Environment
  /** The `claude` to run; rejects when there is none. */
  claudePath(): Promise<string>
  onOutput(id: string, data: string): void
  onExit(id: string, exitCode: number): void
  onStatus(id: string, status: HostedSessionStatus): void
}

/**
 * Runs each Hosted session's `claude` in a pseudoconsole: node-pty with the
 * `conpty.dll` and `OpenConsole.exe` it ships, rather than the older ConPTY
 * built into Windows 10. node-pty is not thread-safe, so every PTY lives here,
 * in the one process that hosts the backend.
 *
 * Until Claude Code's own status signals are read, a Hosted session counts as
 * working while `claude` keeps printing on its own after the user sent it a
 * prompt: Claude Code redraws its spinner many times a second through a turn,
 * and prints nothing while it waits at its prompt. Typing alone, and the
 * replies xterm.js sends to the terminal's own queries, start no turn.
 */
export class SessionHost {
  private readonly sessions = new Map<string, HostedProcess>()

  constructor(private readonly options: SessionHostOptions) {}

  async start(project: string, { cols, rows }: TerminalSize): Promise<HostedSession> {
    const claude = await this.options.claudePath()
    const env = withVariables(this.options.env, HOSTED_ENVIRONMENT)
    const ptyOptions = { name: 'xterm-256color', cols, rows, cwd: project, env, useConptyDll: true }
    // Batch files (an npm install's claude.cmd) only run through cmd.exe, as one quoted command line.
    const pty = /^\.(cmd|bat)$/i.test(extname(claude))
      ? spawn(envVar(env, 'COMSPEC') ?? 'cmd.exe', `/d /s /c ""${claude}""`, ptyOptions)
      : spawn(claude, [], ptyOptions)

    const id = randomUUID()
    const session: HostedProcess = { id, pty, status: 'idle', touchedAt: 0, inTurn: false }
    this.sessions.set(id, session)
    pty.onData((data) => {
      this.options.onOutput(id, data)
      this.noteOutput(session)
    })
    pty.onExit(({ exitCode }) => {
      clearTimeout(session.quietTimer)
      this.sessions.delete(id)
      this.options.onExit(id, exitCode)
    })
    return { id, windowsPty: windowsPty() }
  }

  // A Hosted session that has ended ignores input, resizes and stops.

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.touchedAt = Date.now()
    // Enter sends the prompt; it is the only way a turn starts.
    if (data.includes('\r')) {
      session.inTurn = true
      this.waitForQuiet(session)
    }
    session.pty.write(data)
  }

  resize(id: string, { cols, rows }: TerminalSize): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.touchedAt = Date.now()
    session.pty.resize(cols, rows)
  }

  stop(id: string): void {
    this.sessions.get(id)?.pty.kill()
  }

  /** Ends every Hosted session, as when ClaudeForge closes. */
  dispose(): void {
    for (const { pty, quietTimer } of this.sessions.values()) {
      clearTimeout(quietTimer)
      pty.kill()
    }
    this.sessions.clear()
  }

  /** Output `claude` prints on its own in a turn, not just after the user typed, means it works until it falls quiet. */
  private noteOutput(session: HostedProcess): void {
    if (!session.inTurn || Date.now() - session.touchedAt < REDRAW_MS) return
    if (session.status !== 'working') this.setStatus(session, 'working')
    this.waitForQuiet(session)
  }

  /** Ends the turn once `claude` stays quiet for a while: done if it worked, as it was if it never did. */
  private waitForQuiet(session: HostedProcess): void {
    clearTimeout(session.quietTimer)
    session.quietTimer = setTimeout(() => {
      session.inTurn = false
      if (session.status === 'working') this.setStatus(session, 'done')
    }, QUIET_MS)
  }

  private setStatus(session: HostedProcess, status: HostedSessionStatus): void {
    session.status = status
    this.options.onStatus(session.id, status)
  }
}
