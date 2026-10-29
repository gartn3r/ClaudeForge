// The `claudeforge` command (ADR 0007): what a Hosted session's Claude runs to change ClaudeForge's
// interface. It only carries its arguments to the ClaudeForge that started this Hosted session, over
// the local channel its environment names, with the token that proves which Hosted session asks, then
// prints the answer: ClaudeForge reads the command, checks the caller and words the answer itself.
// Plain Node with no dependency, run by ClaudeForge's own executable as Node (claudeforge.cmd, and
// claudeforge for POSIX shells).
import { connect } from 'node:net'

const NOT_HOSTED = 'claudeforge: Only a Session running in ClaudeForge can change its interface.\n'

const channel = process.env.CLAUDEFORGE_CLI_CHANNEL
const token = process.env.CLAUDEFORGE_CLI_TOKEN

/** Prints what ClaudeForge answered, or why it could not be asked, and ends with its exit code. */
function end({ stdout = '', stderr = '', exitCode }) {
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  process.exitCode = exitCode
}

/** Everything piped in, for an argument `-` that stands for it (`--text -`). */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

if (!channel || !token) {
  end({ stderr: NOT_HOSTED, exitCode: 1 })
} else {
  const args = process.argv.slice(2)
  const stdin = args.includes('-') ? await readStdin() : undefined
  let answer = ''
  const socket = connect(channel)
  socket.setEncoding('utf8')
  socket.on('connect', () => socket.write(JSON.stringify({ token, args, cwd: process.cwd(), stdin }) + '\n'))
  socket.on('data', (data) => (answer += data))
  socket.on('error', () => undefined)
  // One line answers; a channel that closed without one is a ClaudeForge that is gone.
  socket.on('close', () => {
    try {
      end(JSON.parse(answer))
    } catch {
      end({ stderr: 'claudeforge: ClaudeForge cannot be reached: it may have closed.\n', exitCode: 1 })
    }
  })
}
