// The fake `claude`: records how it was called and answers like Claude Code.
// It answers `mcp list` and `plugin list --json` from test/fixtures/claude; later tickets grow it into
// a scriptable TUI stub (status signals, the other mcp/plugin subcommands).
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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
