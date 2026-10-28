// The ClaudeForge CLI's commands (ADR 0007): what `claudeforge <command>` means, read from the
// arguments a Hosted session's Claude ran it with, asked through the Elements contract in that Hosted
// session's name, and answered as the command prints it. The `claudeforge` command itself
// (cli/claudeforge.mjs) only carries the arguments here and prints the answer back.

import { resolve } from 'node:path'
import type { BackendApi } from '../shared/api'
import {
  CONTENT_KINDS,
  CONTENT_TAKEN,
  CREATED_KINDS,
  ELEMENT_NAME_MAX_LENGTH,
  ELEMENT_TITLE_MAX_LENGTH,
  ORDER_BOUNDS,
  OWN_ELEMENTS,
  PROPERTIES,
  describeRefusal,
  itemLabel,
  type Container,
  type ContentItem,
  type ContentItemInput,
  type ContentKind,
  type CreatedElementKind,
  type ElementAnswers,
  type ElementOp,
  type ElementProperties,
  type ElementRequest,
  type ElementView,
  type PropertyName
} from '../shared/elements'

/** One run of `claudeforge`: its arguments, the folder it ran in, and what was piped in for an argument `-`. */
export interface CliCall {
  args: string[]
  cwd: string
  stdin?: string
}

/** What `claudeforge` prints, and the exit code it ends with: 0 done, 1 refused, 2 not understood. */
export interface CliReply {
  stdout: string
  stderr: string
  exitCode: number
}

type Elements = BackendApi['elements']

/** A command used wrongly: answered with what is wrong and where to read how. */
class Usage extends Error {}

/** A request the contract refused, in its words. */
class Refusal extends Error {}

const CONTAINER_WORDS: Record<Container, string> = {
  explorer: 'in the explorer',
  'right-panel': 'in the Right panel',
  'title-bar': 'in the title bar'
}

const KIND_WORDS: Record<CreatedElementKind, string> = {
  'panel-tab': 'a tab of the Right panel',
  card: 'a card in the explorer',
  menu: 'a menu in the title bar'
}

const KIND_NAMES: Record<CreatedElementKind, string> = { 'panel-tab': 'Panel tab', card: 'card', menu: 'menu' }

/** What each kind of content is given as. */
const CONTENT_VALUES: Record<ContentKind, string> = {
  text: 'markdown',
  link: 'address',
  file: 'path',
  'web-page': 'address',
  action: 'command'
}

const CONTENT_WORDS: Record<ContentKind, string> = {
  text: 'Markdown; `--text -` reads it from what is piped in.',
  link: 'An http or https address, which opens in the default browser.',
  file: 'A file, shown as it is on disk now; relative to the current folder.',
  'web-page': 'An http, https or file address, shown apart from the interface.',
  action: 'A command typed into a Session of this Project, never sent: the user sends it.'
}

const PROPERTY_WORDS: Record<PropertyName, string> = {
  visible: 'true or false: shown or hidden.',
  collapsed: 'true or false: folded to its header or open.',
  width: "a column's width, in pixels.",
  order: `a whole number from ${ORDER_BOUNDS.min} to ${ORDER_BOUNDS.max}: its place in its container, lowest first.`,
  title: `text of up to ${ELEMENT_TITLE_MAX_LENGTH} characters.`,
  textColor: 'a colour: #rrggbb, or a CSS colour function such as rgb(...) or oklch(...).',
  backgroundColor: 'a colour, as textColor.'
}

const column = (text: string, width: number): string => text.padEnd(width)

/** The help `claudeforge --help` prints: every command, property and kind of content. */
export const CLI_HELP = [
  "claudeforge: shows this Session's work in ClaudeForge's interface, beside its terminal.",
  '',
  "Only a Session running in ClaudeForge can use it. It reaches ClaudeForge's own Elements and the",
  "Elements created in the Session's Project, which only that Project's Sessions can change.",
  '',
  'Usage: claudeforge <command> [options]',
  '',
  'Commands:',
  '  list [--json]',
  '      Lists the Elements this Session can address: identifiers, properties and Content items;',
  '      as JSON with --json.',
  '  create <kind>:<name> [--title <title>]',
  '      Creates an Element in this Project and brings it to the front. Kinds:',
  ...CREATED_KINDS.map((kind) => `        ${column(kind, 10)} ${KIND_WORDS[kind]}`),
  `      A name is lowercase letters, numbers and hyphens (${ELEMENT_NAME_MAX_LENGTH} at most), unique in the`,
  '      Project: panel-tab:tests, card:release, menu:tests. The title defaults to the name.',
  '  close <element>',
  "      Closes a created Element and its Content items. ClaudeForge's own can only be hidden.",
  '  set <element> <property>=<value>...',
  '      Sets properties, all of them or none. An empty value gives back the default.',
  '  add <element> <content> [--id <id>] [--title <title>] [--show]',
  '      Adds a Content item after the others, or replaces the one under that id. Without --show',
  '      the Element only shows a mark; with it, it comes to the front.',
  '  remove <element> <item>',
  '      Removes a Content item.',
  '',
  'Content, one per add:',
  ...CONTENT_KINDS.map((kind) => `  ${column(`--${kind} <${CONTENT_VALUES[kind]}>`, 22)} ${CONTENT_WORDS[kind]}`),
  '  --title is for any but a text. Each created Element takes:',
  ...CREATED_KINDS.map((kind) => `    ${column(kind, 10)} ${CONTENT_TAKEN[kind].join(', ')}`),
  "  ClaudeForge's own Elements take no Content item.",
  '',
  'Properties, each Element taking only some (list shows which, with their values):',
  ...PROPERTIES.map((property) => `  ${column(property, 16)} ${PROPERTY_WORDS[property]}`),
  '',
  "Elements: ClaudeForge's own are",
  `  ${OWN_ELEMENTS.join(', ')};`,
  'created ones are <kind>:<name>.',
  '',
  'Options of every command:',
  "  --project <folder>  The Project meant: only the Session's own, the default.",
  '  --help              This help.',
  ''
].join('\n')

/** How each command is used, as a mistake names it. */
const USAGE: Record<string, string> = {
  list: 'claudeforge list [--json]',
  create: 'claudeforge create <kind>:<name> [--title <title>]',
  close: 'claudeforge close <element>',
  set: 'claudeforge set <element> <property>=<value>...',
  add: 'claudeforge add <element> --text|--link|--file|--web-page|--action <content> [--id <id>] [--title <title>] [--show]',
  remove: 'claudeforge remove <element> <item>'
}

type OptionKind = 'string' | 'boolean'

/** The options each command takes, `--project` aside. */
const OPTIONS: Record<string, Record<string, OptionKind>> = {
  list: { json: 'boolean' },
  create: { title: 'string' },
  close: {},
  set: {},
  add: {
    ...Object.fromEntries(CONTENT_KINDS.map((kind) => [kind, 'string' as const])),
    id: 'string',
    title: 'string',
    show: 'boolean'
  },
  remove: {}
}

interface Parsed {
  positionals: string[]
  options: Record<string, string | true>
}

/**
 * Reads a command's arguments: `--name value` or `--name=value`, whatever the value holds (a markdown
 * list starts with `-`), and the rest in order.
 */
function parse(command: string, args: readonly string[]): Parsed {
  const taken: Record<string, OptionKind> = { ...OPTIONS[command], project: 'string' }
  const parsed: Parsed = { positionals: [], options: {} }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) {
      parsed.positionals.push(arg)
      continue
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s) as [string, string | undefined]
    const kind = taken[name]
    if (!kind) throw new Usage(`${command} takes no option --${name}.`)
    if (name in parsed.options) throw new Usage(`--${name} is given twice.`)
    if (kind === 'boolean') {
      if (inline !== undefined) throw new Usage(`--${name} takes no value.`)
      parsed.options[name] = true
    } else {
      const value = inline ?? args[++i]
      if (value === undefined) throw new Usage(`--${name} needs a value.`)
      parsed.options[name] = value
    }
  }
  return parsed
}

const string = (parsed: Parsed, name: string): string | undefined => {
  const value = parsed.options[name]
  return typeof value === 'string' ? value : undefined
}

/** A command's positionals, when it is given exactly that many. */
function positionals(command: string, parsed: Parsed, count: number, atLeast = false): string[] {
  const given = parsed.positionals.length
  if (atLeast ? given < count : given !== count) throw new Usage(`Use it as ${USAGE[command]}`)
  return parsed.positionals
}

/** A property's value as typed (`order=3`), as the contract takes it; one that does not hold goes as typed, to be refused. */
function propertyValue(name: string, typed: string): unknown {
  if (typed === '') return null
  if (name === 'visible' || name === 'collapsed') return typed === 'true' ? true : typed === 'false' ? false : typed
  if ((name === 'width' || name === 'order') && /^-?\d+(?:\.\d+)?$/.test(typed)) return Number(typed)
  return typed
}

const shownValue = (value: unknown): string =>
  value === null ? '(default)' : typeof value === 'string' ? JSON.stringify(value) : String(value)

function writerWords(item: ContentItem): string {
  return item.writtenBy.kind === 'user' ? 'by the user' : `by Session ${item.writtenBy.sessionId}`
}

function itemLine(item: ContentItem): string {
  const what = {
    text: JSON.stringify(itemLabel(item).slice(0, 60)),
    link: 'address' in item ? item.address : '',
    'web-page': 'address' in item ? item.address : '',
    file: 'path' in item ? `${item.path}${item.file?.state === 'missing' ? ' (missing)' : ''}` : '',
    action: 'command' in item ? JSON.stringify(item.command) : ''
  }[item.kind]
  const title = 'title' in item && item.title ? ` titled ${JSON.stringify(item.title)}` : ''
  return `    ${item.id}: ${item.kind} ${what}${title}, written ${writerWords(item)}`
}

function elementLines(element: ElementView): string[] {
  const where = element.container ? `, ${CONTAINER_WORDS[element.container]}` : ''
  const what = element.kind ? `${KIND_NAMES[element.kind]} of this Project` : "ClaudeForge's own"
  const properties = element.takes.map((name) => `${name}=${shownValue(element.properties[name])}`)
  return [
    `${element.id} (${what}${where})`,
    `  properties: ${properties.join(' ') || 'none'}`,
    `  takes ${element.contentKinds.length ? element.contentKinds.join(', ') : 'no Content item'}`,
    ...(element.items.length ? ['  items:', ...element.items.map(itemLine)] : [])
  ]
}

/** The Content item an `add` names: exactly one kind of content. */
function itemInput(parsed: Parsed, call: CliCall): ContentItemInput {
  const kinds = CONTENT_KINDS.filter((kind) => kind in parsed.options)
  if (kinds.length !== 1) throw new Usage(`Give add one content: ${CONTENT_KINDS.map((kind) => `--${kind}`).join(', ')}.`)
  const kind = kinds[0]!
  let value = string(parsed, kind)!
  const id = string(parsed, 'id')
  const title = string(parsed, 'title')
  if (kind === 'text' && title !== undefined) throw new Usage('A text has no title: --title is for any other content.')
  if (value === '-') {
    if (kind !== 'text') throw new Usage('Only --text reads what is piped in.')
    value = call.stdin ?? ''
  }
  const named = { ...(id !== undefined && { id }), ...(title !== undefined && { title }) }
  switch (kind) {
    case 'text':
      return { ...named, kind, text: value }
    case 'link':
    case 'web-page':
      return { ...named, kind, address: value }
    case 'file':
      return { ...named, kind, path: resolve(call.cwd, value) }
    case 'action':
      return { ...named, kind, command: value }
  }
}

/** Runs one command, in the name of the Hosted session whose Elements contract is given. */
async function answer(command: string, parsed: Parsed, call: CliCall, elements: Elements): Promise<string> {
  const projectOption = string(parsed, 'project')
  const project = projectOption === undefined ? {} : { project: resolve(call.cwd, projectOption) }
  /** Asks, and answers a refusal as the command's failure. */
  const ask = async <Op extends ElementOp>(request: Extract<ElementRequest, { op: Op }>): Promise<ElementAnswers[Op]> => {
    const result = await elements.request(request)
    if (!result.ok) throw new Refusal(describeRefusal(result.refusal))
    return result
  }

  switch (command) {
    case 'list': {
      positionals(command, parsed, 0)
      const result = await ask({ op: 'list', ...project })
      if (parsed.options.json) return JSON.stringify(result.elements, null, 2) + '\n'
      return ["Elements this Session can address, by identifier:", '', ...result.elements.flatMap(elementLines), ''].join('\n')
    }
    case 'create': {
      const [id] = positionals(command, parsed, 1)
      const at = id!.indexOf(':')
      if (at < 0) throw new Usage(`Name the Element to create as <kind>:<name>, such as panel-tab:${id}.`)
      const title = string(parsed, 'title')
      const kind = id!.slice(0, at) as CreatedElementKind
      await ask({ op: 'create', ...project, kind, name: id!.slice(at + 1), ...(title !== undefined && { title }) })
      return `Created ${id}.\n`
    }
    case 'close': {
      const [element] = positionals(command, parsed, 1)
      await ask({ op: 'close', ...project, element: element! })
      return `Closed ${element}.\n`
    }
    case 'set': {
      const [element, ...assignments] = positionals(command, parsed, 2, true)
      const properties: Record<string, unknown> = {}
      for (const assignment of assignments) {
        const at = assignment.indexOf('=')
        if (at <= 0) throw new Usage(`Set a property as <property>=<value>, not ${assignment}.`)
        const name = assignment.slice(0, at)
        if (name in properties) throw new Usage(`${name} is set twice.`)
        properties[name] = propertyValue(name, assignment.slice(at + 1))
      }
      await ask({ op: 'set', ...project, element: element!, properties: properties as ElementProperties })
      return `Set ${Object.keys(properties).join(', ')} on ${element}.\n`
    }
    case 'add': {
      const [element] = positionals(command, parsed, 1)
      const item = itemInput(parsed, call)
      const result = await ask({ op: 'add', ...project, element: element!, item, ...(parsed.options.show && { show: true }) })
      return result.replaced ? `Replaced ${result.item} in ${element}.\n` : `Added ${result.item} to ${element}.\n`
    }
    case 'remove': {
      const [element, item] = positionals(command, parsed, 2)
      await ask({ op: 'remove', ...project, element: element!, item: item! })
      return `Removed ${item} from ${element}.\n`
    }
    default:
      throw new Usage(`${command} is not a command.`)
  }
}

/** Runs `claudeforge` with these arguments, in the name of the Hosted session whose Elements contract is given. */
export async function runCli(call: CliCall, elements: Elements): Promise<CliReply> {
  const [command, ...rest] = call.args
  if (command === undefined || command === 'help' || call.args.includes('--help') || call.args.includes('-h'))
    return { stdout: CLI_HELP, stderr: '', exitCode: 0 }
  try {
    if (!(command in OPTIONS)) throw new Usage(`${command} is not a command.`)
    return { stdout: await answer(command, parse(command, rest), call, elements), stderr: '', exitCode: 0 }
  } catch (error) {
    if (error instanceof Refusal) return { stdout: '', stderr: `claudeforge: ${error.message}\n`, exitCode: 1 }
    if (error instanceof Usage)
      return { stdout: '', stderr: `claudeforge: ${error.message}\nRun claudeforge --help to see the commands.\n`, exitCode: 2 }
    throw error
  }
}
