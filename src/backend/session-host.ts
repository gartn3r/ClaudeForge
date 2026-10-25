import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { extname } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { HostedSession, TerminalSize } from '../shared/api'
import { envVar, type Environment } from './claude-code'

/** What every Hosted session's `claude` gets on top of ClaudeForge's own environment. */
const HOSTED_ENVIRONMENT: Environment = {
  // ConPTY coalesces Claude Code's positioned writes wrongly; full repaints leave no fragments behind.
  CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1',
  // xterm.js supports synchronized output, but Claude Code's probe settles too late in a terminal it does not know.
  CLAUDE_CODE_FORCE_SYNC_OUTPUT: '1',
  TERM_PROGRAM: 'ClaudeForge',
  // Describes the terminal ClaudeForge was started from, not this one.
  TERM_PROGRAM_VERSION: undefined,
  COLORTERM: 'truecolor'
}

/** The environment with the given variables set or removed, whatever case it spells them in. */
function withVariables(env: Environment, variables: Environment): Environment {
  const names = new Set(Object.keys(variables).map((name) => name.toUpperCase()))
  const result = Object.fromEntries(Object.entries(env).filter(([name]) => !names.has(name.toUpperCase())))
  for (const [name, value] of Object.entries(variables)) if (value !== undefined) result[name] = value
  return result
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
}

/**
 * Runs each Hosted session's `claude` in a pseudoconsole: node-pty with the
 * `conpty.dll` and `OpenConsole.exe` it ships, rather than the older ConPTY
 * built into Windows 10. node-pty is not thread-safe, so every PTY lives here,
 * in the one process that hosts the backend.
 */
export class SessionHost {
  private readonly ptys = new Map<string, IPty>()

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
    this.ptys.set(id, pty)
    pty.onData((data) => this.options.onOutput(id, data))
    pty.onExit(({ exitCode }) => {
      this.ptys.delete(id)
      this.options.onExit(id, exitCode)
    })
    return { id, project, windowsPty: windowsPty() }
  }

  // A Hosted session that has ended ignores input, resizes and stops.

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, { cols, rows }: TerminalSize): void {
    this.ptys.get(id)?.resize(cols, rows)
  }

  stop(id: string): void {
    this.ptys.get(id)?.kill()
  }

  /** Ends every Hosted session, as when ClaudeForge closes. */
  dispose(): void {
    for (const pty of this.ptys.values()) pty.kill()
    this.ptys.clear()
  }
}
