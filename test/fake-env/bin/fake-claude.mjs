// The fake `claude`: records how it was called and answers like Claude Code.
// It answers the `mcp` and `plugin` subcommands ClaudeForge runs from the fake environment's copy of
// test/fixtures/claude, which its changes change, and runs a scriptable stand-in for Claude Code's
// prompt that sends the status signals Claude Code sends its terminal.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { record } from './record.mjs'

// The fake environment's shim always sets the version to report (see FAKE_CLAUDE_VERSION in test/fake-env).
const version = process.env.FAKE_CLAUDE_VERSION
const args = process.argv.slice(2)
record('claude', args)

if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${version} (Claude Code)\n`)
  process.exit(0)
}

/** A file of the fake environment's copy of test/fixtures/claude, or '' when there is none. */
const recording = (...path) => {
  try {
    return readFileSync(join(process.env.FAKE_CLAUDE_STATE, ...path), 'utf8')
  } catch {
    return ''
  }
}

/** Ends like a refused `claude` command: Claude Code's words on stderr, exit code 1. */
const refuse = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

// An Extension change waits while the fake environment holds changes, and fails while it fails them.
if (['mcp', 'plugin'].includes(args[0]) && args[1] !== 'list') {
  const hold = join(process.env.FAKE_CLAUDE_STATE, 'hold-changes')
  while (existsSync(hold)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  const failure = recording('fail-changes')
  if (failure) refuse(failure)
}

/** The value of an option such as `-s user` or `--scope user`. */
const option = (short, long) => {
  const at = args.findIndex((arg) => arg === short || arg === long)
  return at < 0 ? undefined : args[at + 1]
}

/** The current folder as plugins.json names a fixture Project. */
const here = () => relative(process.env.FAKE_PROJECTS_DIR, process.cwd())

const writePlugins = (plugins) =>
  writeFileSync(join(process.env.FAKE_CLAUDE_STATE, 'plugins.json'), JSON.stringify(plugins, null, 2))

// `claude plugin enable|disable|uninstall <id> -s <scope>`: changes the plugin installed at that
// scope (here, for a Project's) in the copy of plugins.json.
if (args[0] === 'plugin' && ['enable', 'disable', 'uninstall', 'remove'].includes(args[1])) {
  const [id, scope] = [args[2], option('-s', '--scope')]
  const plugins = JSON.parse(recording('plugins.json'))
  const plugin = plugins.find(
    (entry) => entry.id === id && entry.scope === scope && (scope === 'user' || entry.projectPath?.toLowerCase() === here().toLowerCase())
  )
  if (!plugin) refuse(`Plugin "${id}" is not installed in ${scope} scope.`)
  if (args[1] === 'uninstall' || args[1] === 'remove') {
    writePlugins(plugins.filter((entry) => entry !== plugin))
    process.stdout.write(`✔ Successfully uninstalled plugin: ${id} (scope: ${scope})\n`)
  } else {
    plugin.enabled = args[1] === 'enable'
    writePlugins(plugins)
    process.stdout.write(`✔ ${args[1] === 'enable' ? 'Enabled' : 'Disabled'} plugin "${id}" (scope: ${scope})\n`)
  }
  process.exit(0)
}

/** The file of `claude mcp list` lines holding a scope's servers, for the Project named like the current folder. */
const mcpFile = (scope) =>
  ({ user: 'user.txt', project: `${basename(process.cwd())}.mcp-json.txt`, local: `${basename(process.cwd())}.txt` })[scope]

/** A scope's server lines, by name. */
const mcpServers = (scope) =>
  new Map(
    recording('mcp-list', mcpFile(scope))
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.split(': ')[0], line])
  )

const writeMcpServers = (scope, servers) =>
  writeFileSync(join(process.env.FAKE_CLAUDE_STATE, 'mcp-list', mcpFile(scope)), [...servers.values()].map((line) => `${line}\n`).join(''))

const MCP_SCOPES = ['user', 'project', 'local']

// `claude mcp list`: the user's servers, then those the Project named like the current folder shares
// in its .mcp.json, then the user's own there. As in Claude Code, the narrower scope wins a name.
if (args[0] === 'mcp' && args[1] === 'list') {
  const servers = new Map()
  for (const scope of MCP_SCOPES) for (const [name, line] of mcpServers(scope)) servers.set(name, line)
  process.stdout.write(
    servers.size > 0
      ? `Checking MCP server health…\n\n${[...servers.values()].join('\n')}\n`
      : 'No MCP servers configured. Use `claude mcp add` to add a server.\n'
  )
  process.exit(0)
}

// `claude mcp add [-s scope] [-t transport] <name> [-e K=V…] [-H header…] <commandOrUrl> [-- args…]`:
// adds a connected server at that scope (local by default), unless the scope has one of that name.
if (args[0] === 'mcp' && args[1] === 'add') {
  const [scope, transport] = [option('-s', '--scope') ?? 'local', option('-t', '--transport') ?? 'stdio']
  const dashes = args.indexOf('--')
  const before = dashes < 0 ? args.slice(2) : args.slice(2, dashes)
  const positional = []
  for (let i = 0; i < before.length; i++) {
    if (['-s', '--scope', '-t', '--transport'].includes(before[i])) i++
    // `-e` and `-H` take every value up to the next option.
    else if (['-e', '--env', '-H', '--header'].includes(before[i])) while (before[i + 1] && !before[i + 1].startsWith('-')) i++
    else positional.push(before[i])
  }
  const [name, ...target] = [...positional, ...(dashes < 0 ? [] : args.slice(dashes + 1))]
  if (!MCP_SCOPES.includes(scope)) refuse(`Invalid scope: ${scope}. Must be one of: local, user, project`)
  const servers = mcpServers(scope)
  if (servers.has(name)) refuse(`MCP server ${name} already exists in ${scope} config`)
  const kind = { stdio: '', http: ' (HTTP)', sse: ' (SSE)' }[transport]
  servers.set(name, `${name}: ${target.join(' ')}${kind} - ✔ Connected`)
  writeMcpServers(scope, servers)
  process.stdout.write(`Added ${transport} MCP server ${name} to ${scope} config\n`)
  process.exit(0)
}

// `claude mcp remove <name> [-s scope]`: from that scope, else from whichever scope has it.
if (args[0] === 'mcp' && args[1] === 'remove') {
  const [name, scope] = [args[2], option('-s', '--scope')]
  const from = scope ? [scope] : MCP_SCOPES.filter((candidate) => mcpServers(candidate).has(name))
  const servers = from[0] && mcpServers(from[0])
  if (!servers?.has(name)) refuse(`No MCP server named "${name}"${scope ? ` in ${scope} scope` : ''}`)
  servers.delete(name)
  writeMcpServers(from[0], servers)
  process.stdout.write(`Removed MCP server "${name}" from ${from[0]} config\n`)
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
  // With `--available`, also the marketplaces' plugins, installed or not.
  const available = JSON.parse(recording('plugins-available.json')).map((plugin) => ({ ...plugin, fakeInstallError: undefined }))
  const listing = args.includes('--available') ? { installed: plugins, available } : plugins
  process.stdout.write(JSON.stringify(listing, null, 2) + '\n')
  process.exit(0)
}

// `claude plugin install <id> -s <scope>`: copies the plugin from the fake marketplace into the
// plugin cache and records it in plugins.json, enabled; an entry's `fakeInstallError` fails it.
if (args[0] === 'plugin' && (args[1] === 'install' || args[1] === 'i')) {
  const [id, scope] = [args[2], option('-s', '--scope') ?? 'user']
  const entry = JSON.parse(recording('plugins-available.json')).find(({ pluginId }) => pluginId === id)
  if (!entry) refuse(`Plugin "${id}" not found in any configured marketplace`)
  if (entry.fakeInstallError) refuse(entry.fakeInstallError)
  const installPath = join('plugins', 'cache', entry.marketplaceName, entry.name, '1.0.0')
  const source = join(process.env.FAKE_CLAUDE_STATE, 'marketplace', entry.name)
  if (existsSync(source)) cpSync(source, join(process.env.CLAUDE_CONFIG_DIR, installPath), { recursive: true })
  const plugins = JSON.parse(recording('plugins.json'))
  plugins.push({
    id,
    version: '1.0.0',
    scope,
    enabled: true,
    installPath,
    ...(scope !== 'user' && { projectPath: here() })
  })
  writePlugins(plugins)
  process.stdout.write(`✔ Successfully installed plugin: ${id} (scope: ${scope})\n`)
  process.exit(0)
}

// Any other Extension command would otherwise start the interactive prompt and never end.
if (args[0] === 'mcp' || args[0] === 'plugin') refuse(`The fake claude does not know \`${args.join(' ')}\`.`)

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
// with `--session-id` or `--resume`: the user's prompt as a turn starts, Claude's answer as it ends.
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

/** The Session id it was given, else the resumed Session's, which it goes on in unless it forks. */
const optionValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const sessionId = optionValue('--session-id') ?? (args.includes('--fork-session') ? undefined : optionValue('--resume'))

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

// Only now that it reads its terminal in raw mode, so nothing typed after the banner is lost. Like
// Claude Code, it asks about status reports as it starts: before its banner, so the terminal's answer
// comes before anything the user types once the banner shows.
if (reportsStatus) write('\x1b]7501;?\x1b\\')
write(`Fake Claude Code\r\nTerminal ${size()}\r\n> `)
process.stdout.on('resize', () => write(`\r\nTerminal resized to ${size()}\r\n> ${prompt.replaceAll('\n', '\r\n  ')}`))
