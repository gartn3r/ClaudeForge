// The ClaudeForge CLI's channel (ADR 0007): how `claudeforge`, run by a Hosted session's Claude,
// reaches this ClaudeForge and proves which Hosted session asks. ClaudeForge listens on a named pipe
// of its own, under a name no other ClaudeForge shares, which only this Windows user can write to,
// and hands each Hosted session's `claude`, in its environment, the pipe's name and a token of its
// own; a call without a token of a Hosted session that still runs is refused. Nothing else reaches
// Claude: the channel only answers the calls it gets.

import { randomBytes } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { BackendApi } from '../shared/api'
import { describeRefusal } from '../shared/elements'
import { runCli, type CliCall, type CliReply } from './cli'
import { envVar, type Environment } from './claude-code'
import type { CliAccess } from './session-host'

/**
 * What ClaudeForge tells each Hosted session's Claude about the CLI, appended to its system prompt.
 * One line with no `"` or `%`, so a `claude` installed as a batch file gets it as it is; `claudeforge
 * --help` says the rest.
 */
export const CLI_INSTRUCTION =
  'You run inside ClaudeForge, whose interface you can change with the claudeforge command: show your work ' +
  '(a report, a link, a file, a command to run next) in Panel tabs, cards and menus of this Project. ' +
  'Run claudeforge --help to learn how.'

/** The longest call the channel reads, well above the longest text a Content item holds. */
const CALL_MAX_LENGTH = 1024 * 1024

/** How long a caller may stay connected without a word: `claudeforge` sends its call at once. */
const IDLE_TIMEOUT_MS = 30_000

const NOT_HOSTED: CliReply = { stdout: '', stderr: `claudeforge: ${describeRefusal({ code: 'not-hosted' })}\n`, exitCode: 1 }

/** A call as `claudeforge` sends it, or null when it is not one. */
function readCall(line: string): (CliCall & { token: string }) | null {
  let call: unknown
  try {
    call = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof call !== 'object' || call === null) return null
  const { token, args, cwd, stdin } = call as Record<string, unknown>
  if (typeof token !== 'string' || typeof cwd !== 'string' || !isAbsolute(cwd)) return null
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return null
  if (stdin !== undefined && typeof stdin !== 'string') return null
  return { token, args, cwd, ...(stdin !== undefined && { stdin }) }
}

/** A name for this ClaudeForge's channel: a named pipe on Windows, a socket file elsewhere. */
const channelPath = (): string => {
  const name = `claudeforge-cli-${randomBytes(16).toString('hex')}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`)
}

/** Where the `claudeforge` command is, and what runs it. */
export interface CliPlace {
  /** The folder holding the command: its shims and the script they run (cli/ in the repository). */
  folder: string
  /** What runs the script: ClaudeForge's own executable, as Node. */
  runtime: string
}

export interface CliChannelOptions extends CliPlace {
  /** The Elements contract in a Hosted session's name. */
  elements(hostedSession: string): BackendApi['elements']
}

export class CliChannel implements CliAccess {
  readonly instruction = CLI_INSTRUCTION
  private readonly path = channelPath()
  /** The Hosted session each token proves, by token. */
  private readonly tokens = new Map<string, string>()
  private readonly server: Server
  private readonly listening: Promise<void>

  constructor(private readonly options: CliChannelOptions) {
    this.server = createServer((socket) => this.serve(socket))
    this.listening = new Promise((listening, failed) => {
      this.server.once('error', failed)
      this.server.listen(this.path, listening)
    })
    // A channel that cannot listen grants nothing instead.
    this.listening.catch(() => undefined)
  }

  /** The variables that give one Hosted session's `claude` the CLI, in that Hosted session's name. */
  async grant(id: string, env: Environment): Promise<Environment | null> {
    try {
      await this.listening
    } catch {
      return null
    }
    const token = randomBytes(32).toString('hex')
    this.tokens.set(token, id)
    return {
      CLAUDEFORGE_CLI_CHANNEL: this.path,
      CLAUDEFORGE_CLI_TOKEN: token,
      CLAUDEFORGE_CLI_RUNTIME: this.options.runtime,
      PATH: [this.options.folder, envVar(env, 'PATH')].filter(Boolean).join(delimiter)
    }
  }

  revoke(id: string): void {
    for (const [token, holder] of this.tokens) if (holder === id) this.tokens.delete(token)
  }

  close(): void {
    this.tokens.clear()
    this.server.close()
  }

  /** Reads one call, a line of JSON, and answers it with one line before closing. */
  private serve(socket: Socket): void {
    let received = ''
    socket.setEncoding('utf8')
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    socket.on('error', () => undefined)
    const onData = (data: string): void => {
      received += data
      const end = received.indexOf('\n')
      if (end < 0) {
        if (received.length > CALL_MAX_LENGTH) socket.destroy()
        return
      }
      socket.off('data', onData)
      void this.reply(received.slice(0, end)).then((reply) => socket.end(JSON.stringify(reply) + '\n'))
    }
    socket.on('data', onData)
  }

  private async reply(line: string): Promise<CliReply> {
    const call = readCall(line)
    const hostedSession = call ? this.tokens.get(call.token) : undefined
    if (!call || hostedSession === undefined) return NOT_HOSTED
    try {
      return await runCli(call, this.options.elements(hostedSession))
    } catch (error) {
      return { stdout: '', stderr: `claudeforge: ClaudeForge failed: ${error instanceof Error ? error.message : String(error)}\n`, exitCode: 1 }
    }
  }
}
