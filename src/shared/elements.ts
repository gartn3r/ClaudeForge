// The Elements of the interface and their Content items (CONTEXT.md, Piloting; ADR 0007), and the
// one contract the ClaudeForge CLI and the interface both go through to read and change them: a
// request and its result, plain data that crosses IPC or a local channel as it is. This file holds
// types and pure rules only, so the backend, the interface and the tests all share them.

import { PANEL_BOUNDS, type PanelId } from './api'
import { hasForbiddenCharacter, isWebAddress, opensInBrowser } from './shortcuts'

/** ClaudeForge's own Elements, by their fixed identifiers: one set of properties for the whole of ClaudeForge. */
export const OWN_ELEMENTS = [
  'title-bar',
  'explorer',
  'shortcuts',
  'sessions',
  'extensions',
  'terminal-area',
  'right-panel',
  'panel-tab:map'
] as const

export type OwnElementId = (typeof OWN_ELEMENTS)[number]

/** What can be created, and only there: a Panel tab in the Right panel, a card in the explorer, a menu in the title bar. */
export const CREATED_KINDS = ['panel-tab', 'card', 'menu'] as const

export type CreatedElementKind = (typeof CREATED_KINDS)[number]

/** The Element that holds others of its kind: the explorer holds cards, the Right panel Panel tabs, the title bar menus. */
export type Container = 'explorer' | 'right-panel' | 'title-bar'

export const CONTAINER_OF: Record<CreatedElementKind, Container> = {
  'panel-tab': 'right-panel',
  card: 'explorer',
  menu: 'title-bar'
}

/** The closed list of properties. */
export const PROPERTIES = ['visible', 'collapsed', 'width', 'order', 'title', 'textColor', 'backgroundColor'] as const

export type PropertyName = (typeof PROPERTIES)[number]

/**
 * An Element's properties, only those it takes. A title or colour of null is the default: ClaudeForge's
 * own words for its own Elements' titles, the design's colours. `order` sorts an Element among those of
 * its container, the lowest first.
 */
export interface ElementProperties {
  visible?: boolean
  collapsed?: boolean
  width?: number
  order?: number
  title?: string | null
  textColor?: string | null
  backgroundColor?: string | null
}

const COLOURS: PropertyName[] = ['textColor', 'backgroundColor']

/** The properties each Element takes, by own Element or created kind; any other is refused. */
export const PROPERTIES_TAKEN: Record<OwnElementId | CreatedElementKind, readonly PropertyName[]> = {
  'title-bar': COLOURS,
  explorer: ['visible', 'collapsed', 'width', ...COLOURS],
  shortcuts: ['visible', 'collapsed', 'order', 'title', ...COLOURS],
  sessions: ['visible', 'collapsed', 'order', 'title', ...COLOURS],
  extensions: ['visible', 'collapsed', 'order', 'title', ...COLOURS],
  // The terminal stays on show: a Session's terminal is never an Element's content.
  'terminal-area': COLOURS,
  'right-panel': ['visible', 'collapsed', 'width', ...COLOURS],
  // Always the first Panel tab.
  'panel-tab:map': ['visible', 'title', ...COLOURS],
  'panel-tab': ['visible', 'order', 'title', ...COLOURS],
  card: ['visible', 'collapsed', 'order', 'title', ...COLOURS],
  menu: ['visible', 'order', 'title', ...COLOURS]
}

/** The columns whose width and collapsed state the app state's layout keeps, as the window shows them today. */
export const COLUMN_PANELS: Partial<Record<OwnElementId, PanelId>> = { explorer: 'explorer', 'right-panel': 'map' }

/** Where each own Element sits, when it sits in a container. */
export const OWN_CONTAINERS: Partial<Record<OwnElementId, Container>> = {
  shortcuts: 'explorer',
  sessions: 'explorer',
  extensions: 'explorer',
  'panel-tab:map': 'right-panel'
}

/** ClaudeForge's own Elements as the Default layout has them. */
export function defaultOwnProperties(id: OwnElementId): ElementProperties {
  const all: Required<ElementProperties> = {
    visible: true,
    collapsed: false,
    width: 0,
    order: 0,
    title: null,
    textColor: null,
    backgroundColor: null
  }
  const panel = COLUMN_PANELS[id]
  if (panel) all.width = PANEL_BOUNDS[panel].default
  // The explorer's cards in the order they have always had; a card created later goes after them.
  all.order = { shortcuts: 1, sessions: 2, extensions: 3 }[id as string] ?? 0
  return pick(all, PROPERTIES_TAKEN[id])
}

export const pick = (properties: ElementProperties, names: readonly PropertyName[]): ElementProperties =>
  Object.fromEntries(names.filter((name) => name in properties).map((name) => [name, properties[name]]))

/** The five kinds of Content item. */
export const CONTENT_KINDS = ['text', 'link', 'file', 'web-page', 'action'] as const

export type ContentKind = (typeof CONTENT_KINDS)[number]

/** What each created kind takes; ClaudeForge's own Elements take no Content item. */
export const CONTENT_TAKEN: Record<CreatedElementKind, readonly ContentKind[]> = {
  'panel-tab': CONTENT_KINDS,
  // A file shows there as a link to it.
  card: ['text', 'link', 'file', 'action'],
  menu: ['link', 'action']
}

/**
 * A Content item as it is asked for. Without an id, one is given; under an id already used in the
 * Element, it replaces that item, else it goes after the rest. A text is markdown; a link opens in the
 * default browser; a file is an absolute path, shown as it is on disk now; a web page shows apart from
 * the interface (ADR 0006); an action is a command typed, never sent, as a Skill shortcut's is.
 */
export type ContentItemInput =
  | { id?: string; kind: 'text'; text: string }
  | { id?: string; kind: 'link'; title?: string; address: string }
  | { id?: string; kind: 'file'; title?: string; path: string }
  | { id?: string; kind: 'web-page'; title?: string; address: string }
  | { id?: string; kind: 'action'; title?: string; command: string }

/** Who wrote a Content item last: the user by hand, or a Session (Claude Code's id), whose write won. */
export type Writer = { kind: 'user' } | { kind: 'session'; sessionId: string }

/** A file as it is on disk now. */
export type FileState = { state: 'present'; size: number; modifiedAt: number } | { state: 'missing' }

/** A Content item as an Element holds it. */
export type ContentItem = ContentItemInput & {
  id: string
  writtenBy: Writer
  /** A file's, as ClaudeForge last found it. */
  file?: FileState
}

/**
 * What asks for a change: the user, through the interface, or a Hosted session's Claude through the
 * ClaudeForge CLI, by ClaudeForge's id for the Hosted session. A Session reaches only its own
 * Project's Created Elements; one whose `claude` no longer runs in ClaudeForge reaches nothing.
 */
export type Asker = { kind: 'user' } | { kind: 'session'; hostedSession: string }

/**
 * What an Element asks of the interface: `front`, come to the front (on show) now; `mark`, show a mark,
 * as its content changed while maybe out of view. Both last until the interface says it was seen.
 */
export type Attention = 'front' | 'mark' | null

/** An Element as the contract lists it. */
export interface ElementView {
  /** Fixed for ClaudeForge's own (`explorer`), `<kind>:<name>` for a Created Element (`card:release`). */
  id: string
  /** The Project a Created Element belongs to; null for ClaudeForge's own. */
  project: string | null
  /** A Created Element's kind; null for ClaudeForge's own. */
  kind: CreatedElementKind | null
  container: Container | null
  /** Only those it takes, as they are now. */
  properties: ElementProperties
  takes: readonly PropertyName[]
  contentKinds: readonly ContentKind[]
  /** In order. */
  items: ContentItem[]
  attention: Attention
}

/**
 * One request of the contract. `project` names the Project whose Created Elements are meant: the
 * displayed one, for the user; a Session's is its own, and naming another is refused. ClaudeForge's
 * own Elements need none.
 */
export type ElementRequest =
  /** Own Elements, and the Project's Created Elements. */
  | { op: 'list'; project?: string }
  | { op: 'create'; project?: string; kind: CreatedElementKind; name: string; title?: string }
  /** Changes properties at once: one refused, none changes. A title or colour of null gives back the default. */
  | { op: 'set'; project?: string; element: string; properties: ElementProperties }
  /** `show` asks for the Element to come to the front, rather than only leave a mark. */
  | { op: 'add'; project?: string; element: string; item: ContentItemInput; show?: boolean }
  | { op: 'remove'; project?: string; element: string; item: string }
  /** Removes a Created Element and its Content items; ClaudeForge's own can only be hidden. */
  | { op: 'close'; project?: string; element: string }
  /** The user: the interface brought the Element to the front or showed it, so its mark goes. */
  | { op: 'seen'; project?: string; element: string }
  /** A file Content item's text as it is on disk now; null when missing, not text, or too long to show. */
  | { op: 'read-file'; project?: string; element: string; item: string }
  /** The user: opens a file Content item in its default app, when it is a document, never a program. */
  | { op: 'open-file'; project?: string; element: string; item: string }
  /** The user: the Default layout (CONTEXT.md). */
  | { op: 'restore-default' }

export type ElementOp = ElementRequest['op']

/** What each request answers when it is done. */
export interface ElementAnswers {
  list: { elements: ElementView[] }
  create: { element: ElementView }
  set: { element: ElementView }
  add: { element: ElementView; item: string; replaced: boolean }
  remove: { element: ElementView }
  close: object
  seen: object
  'read-file': { file: FileState; text: string | null }
  'open-file': object
  'restore-default': object
}

/** Why a request was refused, with what the reason names, for the CLI and the interface to word. */
export type ElementRefusal =
  | { code: 'bad-request' }
  /** The asker is not a Hosted session that still runs in ClaudeForge. */
  | { code: 'not-hosted' }
  | { code: 'user-only'; op: ElementOp }
  | { code: 'other-project'; project: string; own: string }
  /** A Created Element was named without a Project. */
  | { code: 'no-project' }
  | { code: 'unknown-element'; element: string }
  | { code: 'not-created'; element: string }
  | { code: 'bad-kind'; kind: string }
  | { code: 'bad-name'; name: string }
  | { code: 'name-taken'; element: string }
  | { code: 'unknown-property'; property: string }
  | { code: 'property-not-taken'; element: string; property: PropertyName; takes: readonly PropertyName[] }
  | { code: 'bad-value'; property: PropertyName; min?: number; max?: number }
  | { code: 'content-not-taken'; element: string; kind: string; takes: readonly ContentKind[] }
  | { code: 'bad-item'; field: ItemField }
  | { code: 'unknown-item'; element: string; item: string }
  | { code: 'not-a-file'; element: string; item: string }
  | { code: 'not-a-document'; path: string }

export type ElementResult<Op extends ElementOp = ElementOp> =
  | ({ ok: true } & ElementAnswers[Op])
  | { ok: false; refusal: ElementRefusal }

/** A Created Element's name: lowercase letters and numbers in words joined by hyphens, as `release-notes`. */
export const ELEMENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const ELEMENT_NAME_MAX_LENGTH = 40
export const ELEMENT_TITLE_MAX_LENGTH = 80
/** A Content item's id within its Element. */
export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const TEXT_MAX_LENGTH = 100_000
export const ORDER_BOUNDS = { min: -999, max: 999 }

/** A Created Element's identifier. */
export const elementId = (kind: CreatedElementKind, name: string): string => `${kind}:${name}`

export const isOwnElement = (id: string): id is OwnElementId => (OWN_ELEMENTS as readonly string[]).includes(id)

/** The kind and name of a Created Element's identifier; null for any other. */
export function parseElementId(id: string): { kind: CreatedElementKind; name: string } | null {
  const [kind, name, ...rest] = id.split(':')
  if (rest.length || !name || !(CREATED_KINDS as readonly string[]).includes(kind!)) return null
  return { kind: kind as CreatedElementKind, name }
}

/** Whether a Created Element may take this name: not one an own Element's identifier holds (`panel-tab:map`). */
export const isElementName = (kind: CreatedElementKind, name: string): boolean =>
  name.length <= ELEMENT_NAME_MAX_LENGTH && ELEMENT_NAME.test(name) && !isOwnElement(elementId(kind, name))

/** Any colour: `#rgb`, `#rrggbb` (with or without alpha), or a CSS colour function such as `oklch(…)`. */
export function isColor(value: string): boolean {
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?:[-+\d.%\s,/]|deg|g?rad|turn|none)*\)$/i.test(value)
  )
}

/** Width bounds of a column Element, from the panel it is. */
export const widthBounds = (id: OwnElementId): { min: number; max: number } | null => {
  const panel = COLUMN_PANELS[id]
  return panel ? { min: PANEL_BOUNDS[panel].min, max: PANEL_BOUNDS[panel].max } : null
}

/**
 * Why a property's value is refused, or null when it can be set. A width holds within the column's
 * bounds; an order is a whole number; a title is text of up to 80 characters; a colour is any colour.
 */
export function propertyValueRefusal(
  property: PropertyName,
  value: unknown,
  bounds: { min: number; max: number } | null
): ElementRefusal | null {
  const refused = (extra: { min?: number; max?: number } = {}): ElementRefusal => ({ code: 'bad-value', property, ...extra })
  switch (property) {
    case 'visible':
    case 'collapsed':
      return typeof value === 'boolean' ? null : refused()
    case 'width':
      return typeof value === 'number' && Number.isFinite(value) && bounds && value >= bounds.min && value <= bounds.max
        ? null
        : refused(bounds ?? {})
    case 'order':
      return Number.isInteger(value) && (value as number) >= ORDER_BOUNDS.min && (value as number) <= ORDER_BOUNDS.max
        ? null
        : refused(ORDER_BOUNDS)
    case 'title':
      return value === null ||
        (typeof value === 'string' && value.trim() !== '' && value.trim().length <= ELEMENT_TITLE_MAX_LENGTH)
        ? null
        : refused({ max: ELEMENT_TITLE_MAX_LENGTH })
    case 'textColor':
    case 'backgroundColor':
      return value === null || (typeof value === 'string' && isColor(value.trim())) ? null : refused()
  }
}

/** A field of a Content item that can be refused. */
export type ItemField = 'id' | 'kind' | 'text' | 'title' | 'address' | 'path' | 'command'

/** Whether a path is absolute, on Windows (`C:\…`, `\\server\…`) or elsewhere. */
export const isAbsolutePath = (path: string): boolean => /^(?:[a-zA-Z]:[\\/]|\\\\[^\\]|\/)/.test(path)

/**
 * The first field of a Content item the contract refuses, or null when the item can be added. A
 * link must open in the default browser; a web page must be one a Web tab shows; an action's
 * command must be one a Skill shortcut could type (no `"`, `%` or line break).
 */
export function itemProblem(item: ContentItemInput): ItemField | null {
  const text = (value: unknown, max: number): boolean => typeof value === 'string' && value.trim() !== '' && value.length <= max
  const optionalTitle = (value: unknown): boolean => value === undefined || text(value, ELEMENT_TITLE_MAX_LENGTH)
  if (item.id !== undefined && (typeof item.id !== 'string' || !ITEM_ID.test(item.id))) return 'id'
  switch (item.kind) {
    case 'text':
      return text(item.text, TEXT_MAX_LENGTH) ? null : 'text'
    case 'link':
      if (!optionalTitle(item.title)) return 'title'
      return typeof item.address === 'string' && opensInBrowser(item.address) ? null : 'address'
    case 'web-page':
      if (!optionalTitle(item.title)) return 'title'
      return typeof item.address === 'string' && isWebAddress(item.address) ? null : 'address'
    case 'file':
      if (!optionalTitle(item.title)) return 'title'
      return typeof item.path === 'string' && isAbsolutePath(item.path.trim()) ? null : 'path'
    case 'action':
      if (!optionalTitle(item.title)) return 'title'
      return text(item.command, 2000) && !hasForbiddenCharacter(item.command) ? null : 'command'
    default:
      return 'kind'
  }
}

/** The Content item as an Element keeps it: trimmed, with nothing else on it. */
export function tidyItem(item: ContentItemInput, id: string): ContentItemInput & { id: string } {
  const title = 'title' in item && item.title !== undefined ? { title: item.title.trim() } : {}
  switch (item.kind) {
    case 'text':
      return { id, kind: 'text', text: item.text }
    case 'link':
      return { id, kind: 'link', ...title, address: item.address.trim() }
    case 'web-page':
      return { id, kind: 'web-page', ...title, address: item.address.trim() }
    case 'file':
      return { id, kind: 'file', ...title, path: item.path.trim() }
    case 'action':
      return { id, kind: 'action', ...title, command: item.command.trim() }
  }
}

/** What a Content item is called where it shows: its title, else what it points at. */
export function itemLabel(item: ContentItemInput): string {
  if (item.kind === 'text') return item.text.split(/\r?\n/)[0]!.trim()
  if (item.title) return item.title
  if (item.kind === 'file') return item.path.split(/[\\/]/).pop() || item.path
  if (item.kind === 'action') return item.command
  return item.address
}

/**
 * The kinds of file a file Content item opens in its default app: documents, pictures and web pages,
 * never a program or a script, which Windows would run.
 */
const DOCUMENTS = /\.(?:md|markdown|txt|log|json|csv|tsv|xml|ya?ml|html?|pdf|png|jpe?g|gif|svg|webp|bmp)$/i

export const opensAsDocument = (path: string): boolean => DOCUMENTS.test(path.trim())

/** Sorts the Elements of one container: by order, then ClaudeForge's own first, then as they came. */
export function inOrder<T extends Pick<ElementView, 'properties' | 'kind'>>(elements: readonly T[]): T[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort(
      (a, b) =>
        (a.element.properties.order ?? 0) - (b.element.properties.order ?? 0) ||
        Number(a.element.kind !== null) - Number(b.element.kind !== null) ||
        a.index - b.index
    )
    .map(({ element }) => element)
}

/** The refusal in English, as the ClaudeForge CLI answers Claude with it. */
export function describeRefusal(refusal: ElementRefusal): string {
  const list = (names: readonly string[]): string => (names.length ? names.join(', ') : 'nothing')
  switch (refusal.code) {
    case 'bad-request':
      return 'This request is not one ClaudeForge understands.'
    case 'not-hosted':
      return 'Only a Session running in ClaudeForge can change its interface.'
    case 'user-only':
      return `Only the user can ${refusal.op === 'restore-default' ? 'restore the default layout' : `ask for ${refusal.op}`}.`
    case 'other-project':
      return `This Session belongs to ${refusal.own}: it cannot change the Elements of ${refusal.project}.`
    case 'no-project':
      return 'Name the Project whose Elements are meant.'
    case 'unknown-element':
      return `There is no Element ${refusal.element}.`
    case 'not-created':
      return `${refusal.element} is ClaudeForge's own: it can be hidden, not closed.`
    case 'bad-kind':
      return `${refusal.kind} cannot be created: only ${CREATED_KINDS.join(', ')} can.`
    case 'bad-name':
      return `"${refusal.name}" is not a name: use lowercase letters, numbers and hyphens, ${ELEMENT_NAME_MAX_LENGTH} at most.`
    case 'name-taken':
      return `${refusal.element} already exists in this Project.`
    case 'unknown-property':
      return `${refusal.property} is not a property: the properties are ${PROPERTIES.join(', ')}.`
    case 'property-not-taken':
      return `${refusal.element} takes ${list(refusal.takes)} only, not ${refusal.property}.`
    case 'bad-value':
      return `${refusal.property} ${VALUE_WORDS[refusal.property](refusal)}.`
    case 'content-not-taken':
      return `${refusal.element} takes ${refusal.takes.length ? `${list(refusal.takes)} only` : 'no Content item'}, not ${refusal.kind}.`
    case 'bad-item':
      return ITEM_WORDS[refusal.field]
    case 'unknown-item':
      return `${refusal.element} holds no Content item ${refusal.item}.`
    case 'not-a-file':
      return `${refusal.item} in ${refusal.element} is not a file.`
    case 'not-a-document':
      return `${refusal.path} is not a document ClaudeForge opens: it could be a program.`
  }
}

const VALUE_WORDS: Record<PropertyName, (refusal: { min?: number; max?: number }) => string> = {
  visible: () => 'is true or false',
  collapsed: () => 'is true or false',
  width: ({ min, max }) => (min === undefined ? 'cannot be set here' : `is a number of pixels from ${min} to ${max}`),
  order: ({ min, max }) => `is a whole number from ${min} to ${max}`,
  title: ({ max }) => `is text of 1 to ${max} characters, or null for the default`,
  textColor: () => 'is a colour (#rrggbb or a CSS colour function such as rgb(…)), or null for the default',
  backgroundColor: () => 'is a colour (#rrggbb or a CSS colour function such as rgb(…)), or null for the default'
}

const ITEM_WORDS: Record<ItemField, string> = {
  id: 'A Content item id is up to 64 letters, numbers, dots, underscores and hyphens, starting with a letter or number.',
  kind: `A Content item is one of ${CONTENT_KINDS.join(', ')}.`,
  text: `A text holds 1 to ${TEXT_MAX_LENGTH} characters of markdown.`,
  title: `A title is text of 1 to ${ELEMENT_TITLE_MAX_LENGTH} characters.`,
  address: 'A link opens an http or https address (or a local .html page); a web page shows an http, https or file address.',
  path: 'A file is an absolute path.',
  command: 'An action is a command to type: no double quote, percent sign or line break.'
}
