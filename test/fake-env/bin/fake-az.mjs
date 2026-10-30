// The fake `az` with its `azure-devops` extension: records how it was called and replays recorded
// JSON from <FAKE_AZ_RECORDINGS> for the organisation https://devops.example.test/fixture-org:
// `projects.json` for `az devops project list`, `areas.json` and `iterations.json` (the whole tree,
// from which `--path` picks a node) for `az boards area|iteration project list`, and
// `work-items.json` for `az boards query`. `{{today}}`, `{{today+7}}` or `{{today-3}}` in a
// recording is that day, so sprints stay around today. A `mode` file in the recordings answers as an
// `az` nobody signed in to (`signed-out`) or one without the extension (`no-extension`).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { record } from './record.mjs'

const args = process.argv.slice(2)
record('az', args)

const recordings = process.env.FAKE_AZ_RECORDINGS ?? ''
const ORGANIZATION = 'https://devops.example.test/fixture-org'

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

/** The value given to a `--name` option, or undefined. */
const option = (name) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

/** A day relative to today, as `YYYY-MM-DD` in local time. */
function day(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function recording(name) {
  const text = readFileSync(join(recordings, name), 'utf8')
  return JSON.parse(text.replace(/\{\{today([+-]\d+)?\}\}/g, (_, offset) => day(Number(offset ?? 0))))
}

/** The node at a path of a classification tree, or nothing. */
function find(node, path) {
  if (!node) return undefined
  if (node.path.toLowerCase() === path.toLowerCase()) return node
  for (const child of node.children ?? []) {
    const found = find(child, path)
    if (found) return found
  }
  return undefined
}

/** A node with its children down to a depth, as `--depth` cuts the tree. */
function cut(node, depth) {
  if (!node.children) return node
  return { ...node, children: depth > 0 ? node.children.map((child) => cut(child, depth - 1)) : null }
}

function tree(name) {
  const root = recording(name)
  const path = option('--path')
  const node = path ? find(root, path) : root
  if (!node) fail(`ERROR: The requested path '${path}' was not found.`)
  return cut(node, Number(option('--depth') ?? 1))
}

const mode = existsSync(join(recordings, 'mode')) ? readFileSync(join(recordings, 'mode'), 'utf8').trim() : 'signed-in'
const firstOption = args.findIndex((arg) => arg.startsWith('-'))
const command = args.slice(0, firstOption < 0 ? args.length : firstOption).join(' ')

if (args[0] === '--version') {
  process.stdout.write('azure-cli 2.90.0 (fake)\n')
} else if (mode === 'no-extension' && (args[0] === 'boards' || args[0] === 'devops')) {
  fail(`ERROR: '${args[0]}' is misspelled or not recognized by the system.`, 2)
} else if (mode === 'signed-out') {
  fail(
    'ERROR: Before you can run Azure DevOps commands, you need to run the login command(az login if using AAD/MSA identity ' +
      'else az devops login if using PAT token) to setup credentials.'
  )
} else if (option('--org') !== ORGANIZATION) {
  fail('ERROR: The resource cannot be found.  Operation returned a 404 status code.')
} else if (command === 'devops project list') {
  process.stdout.write(JSON.stringify(recording('projects.json')))
} else if (option('--project') !== 'Harbor') {
  fail(`ERROR: TF200016: The following project does not exist: ${option('--project')}.`)
} else if (command === 'boards area project list') {
  process.stdout.write(JSON.stringify(tree('areas.json')))
} else if (command === 'boards iteration project list') {
  process.stdout.write(JSON.stringify(tree('iterations.json')))
} else if (command === 'boards query') {
  if (!option('--wiql')) fail('ERROR: --wiql is required')
  process.stdout.write(JSON.stringify(recording('work-items.json')))
} else {
  fail(`fake az: no recording for "az ${args.join(' ')}"`)
}
