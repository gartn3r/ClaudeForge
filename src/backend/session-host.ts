import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { extname } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { HostedSession, HostedSessionStatus, TerminalSize } from '../shared/api'
import { envVar, type Environment } from './claude-code'
import { HistoryStatus } from './history-status'
import { PROBE_REPLY, ProgramStatusReader, type ProgramStatusState } from './program-status'

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

/** One running `claude`, with what it last said it is doing. */
interface HostedProcess {
  id: string
  project: string
  pty: IPty
  status: HostedSessionStatus
  /** Reads the status signals in its output. */
  reader: ProgramStatusReader
  /** Follows its Session history until `claude` first reports its status itself. */
  history?: HistoryStatus
}

/** The status each reported state gives a Hosted session: blocked waits for the user; a failed turn is over too. */
const STATUS_OF: Record<ProgramStatusState, HostedSessionStatus> = {
  idle: 'idle',
  working: 'working',
  blocked: 'waiting',
  done: 'done',
  error: 'done',
  // Clears what it reported, as when `claude` exits.
  clear: 'idle'
}

const windowsPty = (): HostedSession['windowsPty'] =>
  process.platform === 'win32' ? { backend: 'conpty', buildNumber: Number(release().split('.')[2]) } : null

export interface SessionHostOptions {
  /** ClaudeForge's environment, which `claude` inherits. */
  env: Environment
  /** The Claude Code home, where `claude` keeps each Session's history. */
  claudeHome: string
  /** The `claude` to run; rejects when there is none. */
  claudePath(): Promise<string>
  onOutput(id: string, data: string): void
  onExit(id: string, exitCode: number): void
  onStatus(id: string, status: HostedSessionStatus): void
  /** A turn ended, finished or interrupted. */
  onTurnEnd(id: string, project: string): void
}

/**
 * Runs each Hosted session's `claude` in a pseudoconsole: node-pty with the
 * `conpty.dll` and `OpenConsole.exe` it ships, rather than the older ConPTY
 * built into Windows 10. node-pty is not thread-safe, so every PTY lives here,
 * in the one process that hosts the backend.
 *
 * A Hosted session's status is what `claude` reports to its terminal through
 * the OSC 7501 Program Status Protocol: the Session host answers Claude Code's
 * support probe as the terminal, before xterm.js answers the device-attributes
 * query Claude Code sends after it. Until `claude` reports, which a Claude Code
 * older than 2.1.295 never does, the status follows the Session history, found
 * by the Session id the Session host gives `claude` (`--session-id`).
 */
export class SessionHost {
  private readonly sessions = new Map<string, HostedProcess>()

  constructor(private readonly options: SessionHostOptions) {}

  async start(project: string, { cols, rows }: TerminalSize): Promise<HostedSession> {
    const claude = await this.options.claudePath()
    const env = withVariables(this.options.env, HOSTED_ENVIRONMENT)
    const ptyOptions = { name: 'xterm-256color', cols, rows, cwd: project, env, useConptyDll: true }
    const sessionId = randomUUID()
    const args = ['--session-id', sessionId]
    // Batch files (an npm install's claude.cmd) only run through cmd.exe, as one quoted command line.
    const pty = /^\.(cmd|bat)$/i.test(extname(claude))
      ? spawn(envVar(env, 'COMSPEC') ?? 'cmd.exe', `/d /s /c ""${claude}" ${args.join(' ')}"`, ptyOptions)
      : spawn(claude, args, ptyOptions)

    const id = randomUUID()
    const session: HostedProcess = { id, project, pty, status: 'idle', reader: new ProgramStatusReader() }
    session.history = new HistoryStatus(this.options.claudeHome, sessionId, (status) => this.setStatus(session, status))
    this.sessions.set(id, session)
    pty.onData((data) => {
      for (const signal of session.reader.read(data)) {
        if (signal.kind === 'probe') {
          pty.write(PROBE_REPLY)
        } else {
          session.history?.stop()
          session.history = undefined
          this.setStatus(session, STATUS_OF[signal.state])
        }
      }
      this.options.onOutput(id, data)
    })
    pty.onExit(({ exitCode }) => {
      session.history?.stop()
      this.sessions.delete(id)
      this.options.onExit(id, exitCode)
    })
    return { id, windowsPty: windowsPty() }
  }

  // A Hosted session that has ended ignores input, resizes and stops.

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, { cols, rows }: TerminalSize): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  stop(id: string): void {
    this.sessions.get(id)?.pty.kill()
  }

  /** Ends every Hosted session, as when ClaudeForge closes. */
  dispose(): void {
    for (const { pty, history } of this.sessions.values()) {
      history?.stop()
      pty.kill()
    }
    this.sessions.clear()
  }

  /** A turn ends when a Session that worked or waited for the user is done, or back at rest. */
  private setStatus(session: HostedProcess, status: HostedSessionStatus): void {
    const previous = session.status
    if (status === previous) return
    session.status = status
    this.options.onStatus(session.id, status)
    const inTurn = (s: HostedSessionStatus): boolean => s === 'working' || s === 'waiting'
    if (inTurn(previous) && !inTurn(status)) this.options.onTurnEnd(session.id, session.project)
  }
}
