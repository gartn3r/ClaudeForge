// The fake `claude`: records how it was called and answers like Claude Code.
// It answers `mcp list` and `plugin list --json` from test/fixtures/claude, and runs a scriptable
// stand-in for Claude Code's prompt that sends the status signals Claude Code sends its terminal.
// Later tickets grow it further (the other mcp/plugin subcommands).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { record } from './record.mjs'

// The fake environment's shim always sets the version to report (see FAKE_CLAUDE_VERSION in test/fake-env).
const version = process.env.FAKE_CLAUDE_VERSION
const args = process.argv.slice(2)
record('claude', args)

if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${version} (Claude Code)\n`)
  process.exit(0)
}

/** A recording from the fake environment's test/fixtures/claude, or '' when there is none. */
const recording = (...path) => {
  try {
    return readFileSync(join(process.env.FAKE_CLAUDE_RECORDINGS, ...path), 'utf8')
  } catch {
    return ''
  }
}

// `claude mcp list`: the user's servers, then those of the Project named like the current folder.
// As in Claude Code, a Project's server replaces the user's server of the same name.
if (args[0] === 'mcp' && args[1] === 'list') {
  const servers = new Map()
  for (const file of ['user.txt', `${basename(process.cwd())}.txt`]) {
    for (const line of recording('mcp-list', file).split('\n').filter(Boolean)) servers.set(line.split(': ')[0], line)
  }
  process.stdout.write(
    servers.size > 0
      ? `Checking MCP server health…\n\n${[...servers.values()].join('\n')}\n`
      : 'No MCP servers configured. Use `claude mcp add` to add a server.\n'
  )
  process.exit(0)
}

// `claude plugin list --json`: the recorded plugins, with their paths in the fake environment. Like
// Claude Code, `enabled` says whether the plugin is on here: a Project's plugin only in its Project.
if (args[0] === 'plugin' && args[1] === 'list' && args.includes('--json')) {
  const plugins = JSON.parse(recording('plugins.json')).map(({ installPath, projectPath, enabled, ...plugin }) => {
    const project = projectPath && join(process.env.FAKE_PROJECTS_DIR, projectPath)
    const here = !project || project.toLowerCase() === process.cwd().toLowerCase()
    return {
      ...plugin,
      enabled: enabled && here,
      installPath: join(process.env.CLAUDE_CONFIG_DIR, installPath),
      ...(project && { projectPath: project }),
      projectEnabled: !!project && enabled && here
    }
  })
  process.stdout.write(JSON.stringify(plugins, null, 2) + '\n')
  process.exit(0)
}

// Interactive: a stand-in for Claude Code's prompt. Like Claude Code it reads its terminal in raw
// mode, so Enter (\r) submits and Ctrl+J (\n) inserts a newline. It reports its terminal's size at
// start and on every resize, echoes each submitted prompt, and exits on `/exit`. Like Claude Code it
// names its terminal after the first prompt (`✳ <prompt>`). These prompts stand in for a turn:
// - `/work <ms>`: a spinner redrawn every 100 ms for that long, then `Done.`; any key interrupts it.
// - `/ask [<ms>]`: works that long first, if given, then asks `Red or blue?` and waits for the user;
//   the next prompt answers it, then `Done.`.
// - `/permission`: asks `Allow Bash(npm test)?` as a permission prompt, answered like `/ask`.
// - `/fail`: works briefly, then fails with `API Error`.
//
// Status signals: like Claude Code 2.1.295 and later, it asks its terminal whether it reads OSC 7501
// Program Status reports, and once the terminal says so, reports working, blocked (kind question or
// permission, while it waits for the user), then done or error for each turn, idle when one is
// interrupted, and clear when it exits.
// Older versions send none. Every version keeps the Session history Claude Code keeps, when started
// with `--session-id`: the user's prompt as a turn starts, Claude's answer as it ends.
const write = (text) => process.stdout.write(text)
const size = () => `${process.stdout.columns}x${process.stdout.rows}`
let prompt = ''
let named = false
/** Ends the running `/work` turn, while there is one. */
let endTurn
/** Whether `/ask` waits for the user's answer. */
let asking = false

const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽']

const [major, minor, patch] = version.split('.').map(Number)
const reportsStatus = major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 295)))
/** Set once the terminal answers the support probe. */
let terminalReadsStatus = false
// eslint-disable-next-line no-control-regex -- the reply starts with ESC and ends with BEL or ESC
const PROBE_REPLY = /\x1b\]7501;\?[^\x07\x1b]*(?:\x07|\x1b\\)/g

function report(state, extra = '') {
  if (terminalReadsStatus) write(`\x1b]7501;state=${state}:app=claude-code${extra}\x1b\\`)
}

const sessionIdAt = args.indexOf('--session-id')
const sessionId = sessionIdAt >= 0 ? args[sessionIdAt + 1] : undefined

/** Appends one entry to the Session history, where Claude Code keeps it. */
function remember(entry) {
  if (!sessionId) return
  const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(folder, { recursive: true })
  const line = { ...entry, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString() }
  appendFileSync(join(folder, `${sessionId}.jsonl`), JSON.stringify(line) + '\n')
}

const rememberPrompt = (text) => remember({ type: 'user', message: { role: 'user', content: text } })
const rememberAnswer = (text, stopReason = 'end_turn') =>
  remember({
    type: 'assistant',
    message: { role: 'assistant', stop_reason: stopReason, content: [{ type: 'text', text }] }
  })

function finishTurn() {
  write('\r\nDone.\r\n> ')
  rememberAnswer('Done.')
  report('done')
}

/** Waits for the user to answer a question or a permission prompt. */
function ask(question = 'Red or blue?', kind = 'question') {
  asking = true
  write(`\r\n${question}\r\n> `)
  rememberAnswer(question, 'tool_use')
  report('blocked', `:kind=${kind}:msg=${Buffer.from(question).toString('base64')}`)
}

function fail() {
  write('\r\nAPI Error\r\n> ')
  // Claude Code records a failed request as Claude's message, ending the turn.
  rememberAnswer('API Error', 'stop_sequence')
  report('error')
}

/** Works for a while, then goes on as told: by default, the turn is done. */
function work(ms, then = finishTurn) {
  let frame = 0
  report('working')
  const spinner = setInterval(() => write(`\r${SPINNER[frame++ % SPINNER.length]} Working… ${frame}`), 100)
  const timer = setTimeout(() => {
    stop()
    then()
  }, ms)
  const stop = () => {
    clearInterval(spinner)
    clearTimeout(timer)
    endTurn = undefined
  }
  endTurn = () => {
    stop()
    write('\r\nInterrupted.\r\n> ')
    // Claude Code records an interruption as a message from the user.
    rememberPrompt([{ type: 'text', text: '[Request interrupted by user]' }])
    report('idle')
  }
}

function submit() {
  if (prompt === '/exit') {
    report('clear')
    process.exit(0)
  }
  if (!named && prompt) {
    named = true
    write(`\x1b]0;✳ ${prompt}\x07`)
  }
  const answer = asking
  write(`\r\nYou ${answer ? 'answered' : 'wrote'}: ${JSON.stringify(prompt)}\r\n`)
  const [, command, ms] = /^\/(work|ask|permission|fail)(?: (\d+))?$/.exec(prompt) ?? []
  const text = prompt
  prompt = ''
  if (answer) {
    asking = false
    rememberPrompt(text)
    finishTurn()
  } else if (command === 'work' && ms) {
    rememberPrompt(text)
    work(Number(ms))
  } else if (command === 'ask') {
    rememberPrompt(text)
    if (ms) work(Number(ms), ask)
    else ask()
  } else if (command === 'permission') {
    rememberPrompt(text)
    ask('Allow Bash(npm test)?', 'permission')
  } else if (command === 'fail') {
    rememberPrompt(text)
    work(300, fail)
  } else {
    write('> ')
  }
}

process.stdin.setRawMode?.(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  const keys = chunk.replace(PROBE_REPLY, () => {
    terminalReadsStatus = true
    return ''
  })
  for (const key of keys) {
    if (endTurn) {
      endTurn()
    } else if (key === '\r') {
      submit()
    } else if (key === '\n') {
      prompt += '\n'
      write('\r\n  ')
    } else if (key === '\x7f' || key === '\b') {
      if (prompt && !prompt.endsWith('\n')) {
        prompt = prompt.slice(0, -1)
        write('\b \b')
      }
    } else if (key >= ' ') {
      prompt += key
      write(key)
    }
  }
})
process.stdin.on('end', () => process.exit(0))

// Only now that it reads its terminal in raw mode, so nothing typed after the banner is lost.
write(`Fake Claude Code\r\nTerminal ${size()}\r\n> `)
if (reportsStatus) write('\x1b]7501;?\x1b\\')
process.stdout.on('resize', () => write(`\r\nTerminal resized to ${size()}\r\n> ${prompt.replaceAll('\n', '\r\n  ')}`))
