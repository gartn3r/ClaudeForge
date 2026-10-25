// The fake `gh`: records how it was called and replays recorded JSON from
// <FAKE_GH_RECORDINGS>/api/<path>.json for `gh api <path>`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { record } from './record.mjs'

const args = process.argv.slice(2)
record('gh', args)

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (args[0] === '--version') {
  process.stdout.write('gh version 2.80.0 (fake)\n')
} else if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('github.com\n  ✓ Logged in to github.com account fixture-user (keyring)\n')
} else if (args[0] === 'api' && args[1]) {
  const path = args[1].replace(/^\/+/, '').split('?')[0]
  const file = join(process.env.FAKE_GH_RECORDINGS ?? '', 'api', `${path}.json`)
  if (!existsSync(file)) fail(`fake gh: no recording for "gh api ${args[1]}" (HTTP 404)`)
  process.stdout.write(readFileSync(file, 'utf8'))
} else {
  fail(`fake gh: no recording for "gh ${args.join(' ')}"`)
}
