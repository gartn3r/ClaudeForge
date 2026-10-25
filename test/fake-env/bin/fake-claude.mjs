// The fake `claude`: records how it was called and answers like Claude Code.
// Later tickets grow it into a scriptable TUI stub (status signals, mcp/plugin subcommands).
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
if (args[0] === 'mcp' && args[1] === 'list') {
  const lines = recording('mcp-list', 'user.txt') + recording('mcp-list', `${basename(process.cwd())}.txt`)
  process.stdout.write(
    lines ? `Checking MCP server health…\n\n${lines}` : 'No MCP servers configured. Use `claude mcp add` to add a server.\n'
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
// start and on every resize, echoes each submitted prompt, and exits on `/exit`.
const write = (text) => process.stdout.write(text)
const size = () => `${process.stdout.columns}x${process.stdout.rows}`
let prompt = ''

process.stdin.setRawMode?.(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  for (const key of chunk) {
    if (key === '\r') {
      if (prompt === '/exit') process.exit(0)
      write(`\r\nYou wrote: ${JSON.stringify(prompt)}\r\n> `)
      prompt = ''
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
