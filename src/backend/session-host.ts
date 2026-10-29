import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { extname } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import { folderMissingError, type HostedSession, type HostedSessionStatus, type TerminalSize } from '../shared/api'
import { envVar, type Environment } from './claude-code'
import { HistoryStatus } from './history-status'
import { followRegistryEntry } from './live-sessions'
import { PROBE_REPLY, ProgramStatusReader, type ProgramStatusState } from './program-status'
import { isFolder } from './worktree'

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

/** How long closing ClaudeForge waits for a stopped `claude` to end before it closes anyway. */
const STOP_TIMEOUT_MS = 5_000

/** One running `claude`, with what it last said it is doing. */
interface HostedProcess {
  id: string
  /** The folder `claude` runs in: its Project, or a git worktree of it. */
  folder: string
  /** Claude Code's id for the Session it runs now: the one it started with, until `/clear` or `/resume` moves it on. */
  sessionId: string
  pty: IPty
  status: HostedSessionStatus
  /** Reads the status signals in its output. */
  reader: ProgramStatusReader
  /** Follows its Session history until `claude` shows it reports its status itself. */
  history?: HistoryStatus
  /** Stops following its registry entry for the Sessions `/clear` and `/resume` move it to. */
  stopFollowingRegistry: () => void
  /** Resolves once `claude` has ended. */
  ended: Promise<void>
}

/** The status each reported state gives a Hosted session: blocked waits for the user; a failed turn is over too. */
const STATUS_OF_REPORT: Record<ProgramStatusState, HostedSessionStatus> = {
  idle: 'idle',
  working: 'working',
  blocked: 'waiting',
  done: 'done',
  error: 'done',
  // Clears what it reported, as when `claude` exits.
  clear: 'idle'
}

/** What cmd.exe changes in a quoted argument: `%` expands a variable, `"` ends the quotes, a line break the command. */
const CMD_CHANGES = /["%\r\n]/

/** Whether a Session in this status is in the middle of a turn. */
const midTurn = (status: HostedSessionStatus): boolean => status === 'working' || status === 'waiting'

/**
 * The options to start `claude` with and the Session id they give it. A resumed Session keeps its
 * id; any other gets a new one (`--session-id`), which Claude Code also takes with `--fork-session`.
 */
function withSessionId(args: readonly string[]): { sessionId: string; args: string[] } {
  const resumed = args.indexOf('--resume')
  if (resumed >= 0 && !args.includes('--fork-session')) return { sessionId: args[resumed + 1]!, args: [...args] }
  const sessionId = randomUUID()
  return { sessionId, args: [...args, '--session-id', sessionId] }
}

function stopFollowingHistory(session: HostedProcess): void {
  session.history?.stop()
  session.history = undefined
}

const windowsPty = (): HostedSession['windowsPty'] =>
  process.platform === 'win32' ? { backend: 'conpty', buildNumber: Number(release().split('.')[2]) } : null

/**
 * What lets a Hosted session's Claude pilot ClaudeForge's interface through the ClaudeForge CLI (ADR
 * 0007): what its `claude` gets to reach the CLI in its name, and what it is told about it.
 */
export interface CliAccess {
  /**
   * The variables to set on top of ClaudeForge's environment for one Hosted session's `claude`; null
   * when the CLI cannot be offered now.
   */
  grant(id: string, env: Environment): Promise<Environment | null>
  /** The Hosted session has ended: what it was granted no longer reaches anything. */
  revoke(id: string): void
  /** Appended to Claude's system prompt: one line that cmd.exe passes on as it is (CMD_CHANGES). */
  instruction: string
}

export interface SessionHostOptions {
  /** ClaudeForge's environment, which `claude` inherits. */
  env: Environment
  /** The Claude Code home, where `claude` keeps each Session's history. */
  claudeHome: string
  /** The `claude` to run; rejects when there is none. */
  claudePath(): Promise<string>
  /** Puts a Session id on ClaudeForge's list of Sessions (ADR 0005); resolves once it is saved. */
  recordSession(sessionId: string): Promise<void>
  onOutput(id: string, data: string): void
  onExit(id: string, exitCode: number): void
  onStatus(id: string, status: HostedSessionStatus): void
  /** A turn ended, finished or interrupted. */
  onTurnEnd(id: string, cwd: string): void
  /** The ClaudeForge CLI, for every Hosted session; absent, they go without. */
  cli?: CliAccess
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
 * query Claude Code sends after it. Until `claude` asks about status reports,
 * which a Claude Code older than 2.1.295 never does, the status follows the Session history, found
 * by the Session id: the resumed Session's, or one the Session host gives `claude`.
 *
 * Every Session id that appears in a Hosted session goes on ClaudeForge's list of Sessions: the one
 * `claude` starts with, before it starts, then each one `/clear` or `/resume` moves it to, which its
 * entry in Claude Code's live-session registry names.
 *
 * With the ClaudeForge CLI, each `claude` also gets, in its environment, what lets its Claude run
 * `claudeforge` in that Hosted session's name, until it ends, and one line about it at the end of
 * its system prompt (ADR 0007).
 */
export class SessionHost {
  private readonly sessions = new Map<string, HostedProcess>()

  constructor(private readonly options: SessionHostOptions) {}

  /**
   * Starts `claude` with the given options in the folder the Session runs in: its Project, or a git
   * worktree of it. Refused when that folder is gone, as ConPTY would only report an exit code.
   */
  async start(folder: string, { cols, rows }: TerminalSize, args: readonly string[] = []): Promise<HostedSession> {
    if (!(await isFolder(folder))) throw folderMissingError(folder)
    const claude = await this.options.claudePath()
    const { cli } = this.options
    const id = randomUUID()
    // A Session goes on without the CLI when ClaudeForge cannot offer it, and is not told about it then.
    const granted = (await cli?.grant(id, this.options.env)) ?? null
    const { sessionId, args: startArgs } = withSessionId(args)
    const claudeArgs = cli && granted ? [...startArgs, '--append-system-prompt', cli.instruction] : startArgs
    const env = withVariables(this.options.env, { ...HOSTED_ENVIRONMENT, ...granted })
    const ptyOptions = { name: 'xterm-256color', cols, rows, cwd: folder, env, useConptyDll: true }
    let pty: IPty
    try {
      // Batch files (an npm install's claude.cmd) only run through cmd.exe, as one quoted command line.
      // Each option is quoted as is, so one that cmd.exe would expand or cut short is refused.
      const batch = /^\.(cmd|bat)$/i.test(extname(claude))
      const changed = batch ? claudeArgs.find((arg) => CMD_CHANGES.test(arg)) : undefined
      if (changed !== undefined) throw new Error(`cmd.exe cannot pass ${JSON.stringify(changed)} to ${claude} as it is`)
      await this.options.recordSession(sessionId)
      pty = batch
        ? spawn(
            envVar(env, 'COMSPEC') ?? 'cmd.exe',
            `/d /s /c ""${claude}"${claudeArgs.map((arg) => ` "${arg}"`).join('')}"`,
            ptyOptions
          )
        : spawn(claude, claudeArgs, ptyOptions)
    } catch (error) {
      cli?.revoke(id)
      throw error
    }

    let ended!: () => void
    const session: HostedProcess = {
      id,
      folder,
      sessionId,
      pty,
      status: 'idle',
      reader: new ProgramStatusReader(),
      // A Session id that fails to save now is lost to the list, as the Session goes on regardless.
      stopFollowingRegistry: followRegistryEntry(this.options.claudeHome, sessionId, (next) => {
        session.sessionId = next
        void this.options.recordSession(next).catch(() => undefined)
      }),
      ended: new Promise((resolve) => (ended = resolve))
    }
    session.history = new HistoryStatus(this.options.claudeHome, folder, sessionId, (status) =>
      this.setStatus(session, status)
    )
    this.sessions.set(id, session)
    pty.onData((data) => {
      for (const signal of session.reader.read(data)) {
        // A `claude` that asks whether its terminal reads status reports sends them: its history says no more.
        stopFollowingHistory(session)
        if (signal.kind === 'probe') pty.write(PROBE_REPLY)
        else this.setStatus(session, STATUS_OF_REPORT[signal.state])
      }
      this.options.onOutput(id, data)
    })
    pty.onExit(({ exitCode }) => {
      cli?.revoke(id)
      stopFollowingHistory(session)
      session.stopFollowingRegistry()
      this.sessions.delete(id)
      this.options.onExit(id, exitCode)
      ended()
    })
    return { id, sessionId, windowsPty: windowsPty() }
  }

  /** The Hosted sessions whose `claude` still runs, oldest first. */
  running(): Array<{ id: string; folder: string }> {
    return [...this.sessions.values()].map(({ id, folder }) => ({ id, folder }))
  }

  /** A Hosted session whose `claude` still runs: its folder, and the Session it runs now; undefined for any other. */
  describe(id: string): { folder: string; sessionId: string } | undefined {
    const session = this.sessions.get(id)
    return session && { folder: session.folder, sessionId: session.sessionId }
  }

  /** The Hosted sessions in the middle of a turn Claude is working through, oldest first. */
  working(): string[] {
    return [...this.sessions.values()].filter(({ status }) => status === 'working').map(({ id }) => id)
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

  /** Stops every Hosted session's `claude`; resolves once each has ended, or a few seconds later at most. */
  async stopAll(): Promise<void> {
    const sessions = [...this.sessions.values()]
    for (const session of sessions) session.pty.kill()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, STOP_TIMEOUT_MS)))
    await Promise.race([Promise.all(sessions.map(({ ended }) => ended)), timeout])
    clearTimeout(timer)
  }

  /** Ends every Hosted session at once, as when ClaudeForge's window is gone. */
  dispose(): void {
    for (const session of this.sessions.values()) {
      this.options.cli?.revoke(session.id)
      stopFollowingHistory(session)
      session.stopFollowingRegistry()
      session.pty.kill()
    }
    this.sessions.clear()
  }

  /** A turn ends when a Session that worked or waited for the user is done, or back at rest. */
  private setStatus(session: HostedProcess, status: HostedSessionStatus): void {
    const previous = session.status
    if (status === previous) return
    session.status = status
    this.options.onStatus(session.id, status)
    if (midTurn(previous) && !midTurn(status)) this.options.onTurnEnd(session.id, session.folder)
  }
}
