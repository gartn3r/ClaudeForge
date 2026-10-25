// The fake `claude`: records how it was called and answers like Claude Code.
// It answers `mcp list` and `plugin list --json` from test/fixtures/claude; later tickets grow it into
// a scriptable TUI stub (status signals, the other mcp/plugin subcommands).
import { readFileSync } from 'node:fs'
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
// names its terminal after the first prompt (`✳ <prompt>`). `/work <ms>` stands in for a turn: a
// spinner redrawn every 100 ms for that long, then `Done.`; any key interrupts it.
const write = (text) => process.stdout.write(text)
const size = () => `${process.stdout.columns}x${process.stdout.rows}`
let prompt = ''
let named = false
/** Ends the running `/work` turn, while there is one. */
let endTurn

const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽']

function work(ms) {
  let frame = 0
  const spinner = setInterval(() => write(`\r${SPINNER[frame++ % SPINNER.length]} Working… ${frame}`), 100)
  const timer = setTimeout(() => endTurn(), ms)
  endTurn = () => {
    clearInterval(spinner)
    clearTimeout(timer)
    endTurn = undefined
    write('\r\nDone.\r\n> ')
  }
}

function submit() {
  if (prompt === '/exit') process.exit(0)
  if (!named && prompt) {
    named = true
    write(`\x1b]0;✳ ${prompt}\x07`)
  }
  write(`\r\nYou wrote: ${JSON.stringify(prompt)}\r\n`)
  const ms = /^\/work (\d+)$/.exec(prompt)?.[1]
  prompt = ''
  if (ms) work(Number(ms))
  else write('> ')
}

process.stdin.setRawMode?.(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  for (const key of chunk) {
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
process.stdout.on('resize', () => write(`\r\nTerminal resized to ${size()}\r\n> ${prompt.replaceAll('\n', '\r\n  ')}`))
