// The fake `claude`: records how it was called and answers like Claude Code.
// Later tickets grow it into a scriptable TUI stub (status signals, mcp/plugin subcommands).
import { record } from './record.mjs'

export const FAKE_CLAUDE_VERSION = '2.1.300'

const args = process.argv.slice(2)
record('claude', args)

if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${FAKE_CLAUDE_VERSION} (Claude Code)\n`)
  process.exit(0)
}

// Interactive: print a banner and echo each line of input until stdin closes.
process.stdout.write('Fake Claude Code\r\n> ')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => process.stdout.write(`${chunk.replace(/\r?\n/g, '\r\n')}> `))
process.stdin.on('end', () => process.exit(0))
