// The fake `claude`: records how it was called and answers like Claude Code.
// Later tickets grow it into a scriptable TUI stub (status signals, mcp/plugin subcommands).
import { record } from './record.mjs'

// The fake environment's shim always sets the version to report (see FAKE_CLAUDE_VERSION in test/fake-env).
const version = process.env.FAKE_CLAUDE_VERSION
const args = process.argv.slice(2)
record('claude', args)

if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${version} (Claude Code)\n`)
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
