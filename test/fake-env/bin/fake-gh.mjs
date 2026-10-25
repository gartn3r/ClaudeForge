// The fake `gh`: records how it was called and replays recorded JSON from
// <FAKE_GH_RECORDINGS>: `api/<path>.json` for `gh api <path>`, and
// `repo-view/<folder>.json` for `gh repo view` run in a folder.
// FAKE_GH_SIGNED_OUT=1 answers as a `gh` nobody signed in to.
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { record } from './record.mjs'

const args = process.argv.slice(2)
record('gh', args)

const recordings = process.env.FAKE_GH_RECORDINGS ?? ''

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

/** `gh api [--method GET] <path> [-f key=value]… [--paginate] [--slurp]`, as far as ClaudeForge uses it. */
function api(rest) {
  let path
  const params = {}
  let slurp = false
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--method' || arg === '-X') i++
    else if (arg === '-f' || arg === '-F' || arg === '--raw-field' || arg === '--field') {
      const [key, ...value] = rest[++i].split('=')
      params[key] = value.join('=')
    } else if (arg === '--slurp') slurp = true
    else if (arg === '--paginate') continue
    else if (arg.startsWith('-')) fail(`fake gh: unknown flag ${arg}`)
    else path ??= arg
  }
  if (!path) fail('fake gh: gh api needs a path')
  const [route, query] = path.replace(/^\/+/, '').split('?')
  for (const pair of new URLSearchParams(query ?? '')) params[pair[0]] = pair[1]
  const file = join(recordings, 'api', `${route}.json`)
  if (!existsSync(file)) {
    process.stdout.write('{"message":"Not Found","status":"404"}')
    fail(`fake gh: no recording for "gh api ${route}"\ngh: Not Found (HTTP 404)`)
  }
  let body = JSON.parse(readFileSync(file, 'utf8'))
  // The issue-list filters, applied to a recording of every issue.
  if (Array.isArray(body) && params.state && params.state !== 'all') body = body.filter((item) => item.state === params.state)
  if (Array.isArray(body) && params.labels) {
    const wanted = params.labels.split(',')
    body = body.filter((item) => wanted.every((name) => item.labels.some((label) => label.name === name)))
  }
  // One page holds everything a recording has.
  process.stdout.write(JSON.stringify(slurp ? [body] : body))
}

if (args[0] === '--version') {
  process.stdout.write('gh version 2.80.0 (fake)\n')
} else if (process.env.FAKE_GH_SIGNED_OUT === '1') {
  if (args[0] === 'auth' && args[1] === 'status') {
    fail('You are not logged into any GitHub hosts. To log in, run: gh auth login')
  }
  fail(
    'To get started with GitHub CLI, please run:  gh auth login\n' +
      'Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.',
    4
  )
} else if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('github.com\n  ✓ Logged in to github.com account fixture-user (keyring)\n')
} else if (args[0] === 'repo' && args[1] === 'view') {
  const file = join(recordings, 'repo-view', `${basename(process.cwd())}.json`)
  if (!existsSync(file)) fail('failed to run git: fatal: not a git repository (or any of the parent directories): .git')
  process.stdout.write(readFileSync(file, 'utf8'))
} else if (args[0] === 'api') {
  api(args.slice(1))
} else {
  fail(`fake gh: no recording for "gh ${args.join(' ')}"`)
}
