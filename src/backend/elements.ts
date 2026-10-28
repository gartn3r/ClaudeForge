import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PANEL_BOUNDS, type AppState, type AppStatePatch, type BackendApi } from '../shared/api'
import {
  COLUMN_PANELS,
  CONTAINER_OF,
  CONTENT_KINDS,
  CONTENT_TAKEN,
  CREATED_KINDS,
  OWN_CONTAINERS,
  OWN_ELEMENTS,
  PROPERTIES,
  PROPERTIES_TAKEN,
  defaultOwnProperties,
  elementId,
  isElementName,
  isOwnElement,
  itemProblem,
  opensAsDocument,
  parseElementId,
  pick,
  propertyValueRefusal,
  tidyItem,
  widthBounds,
  type Asker,
  type Attention,
  type ContentItem,
  type ContentItemInput,
  type CreatedElementKind,
  type ElementAnswers,
  type ElementOp,
  type ElementProperties,
  type ElementRefusal,
  type ElementRequest,
  type ElementResult,
  type ElementView,
  type FileState,
  type OwnElementId,
  type PropertyName,
  type Writer
} from '../shared/elements'
import { pathKey } from './worktree'

export const ELEMENTS_FILE = 'elements.json'

/** The longest file a file Content item shows the text of; a longer one shows as a file only. */
const FILE_TEXT_MAX_BYTES = 1024 * 1024

/** A Content item as it is kept: its file's state is looked at on disk, never kept. */
type StoredItem = ContentItemInput & { id: string; writtenBy: Writer }

interface StoredElement {
  kind: CreatedElementKind
  name: string
  properties: ElementProperties
  items: StoredItem[]
  attention: Attention
}

interface StoredProject {
  /** The Project's folder, as it was first named. */
  path: string
  /** As they were created. */
  elements: StoredElement[]
}

/** Every Element's state, kept in ClaudeForge's own data folder. */
interface ElementsState {
  version: 1
  /**
   * What changed on ClaudeForge's own Elements, apart from the columns' width and collapsed state,
   * which the app state's layout keeps; an Element left out has the Default layout.
   */
  own: Partial<Record<OwnElementId, ElementProperties>>
  /** By Project folder, compared as Windows does. */
  projects: Record<string, StoredProject>
}

const emptyState = (): ElementsState => ({ version: 1, own: {}, projects: {} })

export interface ElementsOptions {
  /** ClaudeForge's own data folder. */
  stateDir: string
  /** The app state's layout, where the explorer's and the Right panel's width and collapsed state live. */
  layout: {
    read(): Promise<AppState['layout']>
    write(layout: NonNullable<AppStatePatch['layout']>): Promise<unknown>
  }
  /** The Session a Hosted session runs (Claude Code's id) and its Project, while its `claude` runs; null for any other. */
  hostedSession(id: string): Promise<{ sessionId: string; project: string } | null>
  /** Opens a document in its default app. */
  openFile(path: string): Promise<void>
  /** Elements changed: a Project's Created Elements, or ClaudeForge's own (null). */
  onChange(project: string | null): void
  /** How often each file Content item's file is looked at, in milliseconds. */
  fileInterval?: number
}

/** Who asks, once checked: who writes, and the Project whose Created Elements it reaches (null: none named). */
interface Caller {
  asker: Asker['kind']
  writer: Writer
  project: string | null
}

type Target = { own: OwnElementId } | { created: StoredElement; project: StoredProject }

/** A refusal, thrown while a request is handled and answered as the result. */
class Refused extends Error {
  constructor(readonly refusal: ElementRefusal) {
    super(refusal.code)
  }
}

const refuse = (refusal: ElementRefusal): never => {
  throw new Refused(refusal)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** The properties of a kept Element that its kind takes and that hold, as a patch would have them. */
function keptProperties(value: unknown, takes: readonly PropertyName[], bounds: { min: number; max: number } | null): ElementProperties {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    takes.filter((name) => name in value && !propertyValueRefusal(name, value[name], bounds)).map((name) => [name, value[name]])
  )
}

/** The Elements file as read, keeping only what holds, so a hand-edited or older file never breaks the interface. */
function readState(raw: unknown): ElementsState {
  const state = emptyState()
  if (!isRecord(raw)) return state
  if (isRecord(raw.own)) {
    for (const id of OWN_ELEMENTS) {
      const kept = keptProperties(raw.own[id], ownStoredProperties(id), widthBounds(id))
      if (Object.keys(kept).length) state.own[id] = kept
    }
  }
  if (!isRecord(raw.projects)) return state
  for (const project of Object.values(raw.projects)) {
    if (!isRecord(project) || typeof project.path !== 'string' || !Array.isArray(project.elements)) continue
    const elements: StoredElement[] = []
    for (const element of project.elements) {
      if (!isRecord(element)) continue
      const { kind, name, items, attention } = element
      if (!(CREATED_KINDS as readonly unknown[]).includes(kind) || typeof name !== 'string') continue
      const created = kind as CreatedElementKind
      if (!isElementName(created, name) || elements.some((each) => each.kind === kind && each.name === name)) continue
      const properties = { ...createdProperties(created, name, 0), ...keptProperties(element.properties, PROPERTIES_TAKEN[created], null) }
      // A Created Element always has a title: its name when none was given.
      if (properties.title === null) properties.title = name
      elements.push({
        kind: created,
        name,
        properties,
        items: Array.isArray(items) ? items.flatMap((item) => keptItem(item, created)) : [],
        attention: attention === 'front' || attention === 'mark' ? attention : null
      })
    }
    if (elements.length) state.projects[pathKey(project.path)] = { path: project.path, elements }
  }
  return state
}

function keptItem(item: unknown, kind: CreatedElementKind): StoredItem[] {
  if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.writtenBy)) return []
  const input = item as ContentItemInput & { id: string }
  if (!CONTENT_TAKEN[kind].includes(input.kind) || itemProblem(input)) return []
  const { writtenBy } = item
  const writer: Writer =
    writtenBy.kind === 'session' && typeof writtenBy.sessionId === 'string'
      ? { kind: 'session', sessionId: writtenBy.sessionId }
      : { kind: 'user' }
  return [{ ...tidyItem(input, input.id), writtenBy: writer }]
}

/** The properties an own Element keeps in the Elements file: the columns' width and collapsed state are the layout's. */
const ownStoredProperties = (id: OwnElementId): PropertyName[] =>
  PROPERTIES_TAKEN[id].filter((name) => !(COLUMN_PANELS[id] && (name === 'width' || name === 'collapsed')))

/** A new Created Element's properties: shown, expanded, after the others of its container. */
const createdProperties = (kind: CreatedElementKind, name: string, order: number): ElementProperties =>
  pick(
    { visible: true, collapsed: false, order, title: name, textColor: null, backgroundColor: null },
    PROPERTIES_TAKEN[kind]
  )

/** A file as it is on disk now. */
async function fileState(path: string): Promise<FileState> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? { state: 'present', size: stats.size, modifiedAt: stats.mtimeMs } : { state: 'missing' }
  } catch {
    return { state: 'missing' }
  }
}

/** A file's text, or null when it is missing, too long to show, or not text (it holds a NUL byte). */
async function fileText(path: string, file: FileState): Promise<string | null> {
  if (file.state !== 'present' || file.size > FILE_TEXT_MAX_BYTES) return null
  try {
    const handle = await open(path)
    try {
      const bytes = await handle.readFile()
      return bytes.includes(0) ? null : bytes.toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/**
 * ClaudeForge's Elements and their Content items: the one contract the ClaudeForge CLI and the
 * interface go through (ADR 0007). Each request is answered for whoever asks: the user reaches every
 * Element of the Project they name; a Hosted session's Claude only ClaudeForge's own Elements and its
 * own Project's Created Elements. Kept as one JSON file in ClaudeForge's own data folder; requests
 * run one at a time, and each that changes something is written before it is answered.
 */
export class Elements {
  private readonly file: string
  private state: ElementsState | undefined
  private queue: Promise<unknown> = Promise.resolve()
  /** Every file followed, by the Element and Content item showing it, with its listener. */
  private readonly followed = new Map<string, { path: string; listener: (current: Stats, previous: Stats) => void }>()
  private disposed = false

  constructor(private readonly options: ElementsOptions) {
    this.file = join(options.stateDir, ELEMENTS_FILE)
    // The files kept from the last run are followed again from the start.
    void this.run(async () => undefined)
  }

  /** The contract, as one asker reaches it. */
  as(asker: Asker): BackendApi['elements'] {
    return {
      request: <Op extends ElementOp>(request: Extract<ElementRequest, { op: Op }>) =>
        this.run(() => this.handle(asker, request)) as Promise<ElementResult<Op>>
    }
  }

  dispose(): void {
    this.disposed = true
    for (const { path, listener } of this.followed.values()) unwatchFile(path, listener)
    this.followed.clear()
  }

  /** Runs after every request before it, so none sees another half done. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (!this.state) {
        this.state = await this.load()
        this.followAll()
      }
      return task()
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private async handle(asker: Asker, request: unknown): Promise<ElementResult> {
    try {
      if (!isRecord(request) || typeof request.op !== 'string') return refuse({ code: 'bad-request' })
      const caller = await this.caller(asker, request.project)
      const answer = await this.answer(caller, request as ElementRequest)
      return { ok: true, ...answer } as ElementResult
    } catch (error) {
      if (error instanceof Refused) return { ok: false, refusal: error.refusal }
      throw error
    }
  }

  private async caller(asker: Asker, project: unknown): Promise<Caller> {
    if (project !== undefined && typeof project !== 'string') return refuse({ code: 'bad-request' })
    if (asker.kind === 'user') return { asker: 'user', writer: { kind: 'user' }, project: project ?? null }
    const hosted = await this.options.hostedSession(asker.hostedSession)
    if (!hosted) return refuse({ code: 'not-hosted' })
    if (project !== undefined && pathKey(project) !== pathKey(hosted.project))
      return refuse({ code: 'other-project', project, own: hosted.project })
    return { asker: 'session', writer: { kind: 'session', sessionId: hosted.sessionId }, project: hosted.project }
  }

  private async answer(caller: Caller, request: ElementRequest): Promise<ElementAnswers[ElementOp]> {
    const userOnly = (): void => {
      if (caller.asker !== 'user') refuse({ code: 'user-only', op: request.op })
    }
    switch (request.op) {
      case 'list':
        return { elements: await this.views(caller.project) }
      case 'create':
        return { element: await this.create(caller, request) }
      case 'set':
        return { element: await this.set(caller, request.element, request.properties) }
      case 'add':
        return this.add(caller, request)
      case 'remove': {
        // ClaudeForge's own Elements hold no Content item.
        const unknownItem = { code: 'unknown-item', element: String(request.element), item: String(request.item) } as const
        const { created, project } = this.createdTarget(caller, request.element, unknownItem)
        const index = created.items.findIndex((item) => item.id === request.item)
        if (index < 0) return refuse(unknownItem)
        created.items.splice(index, 1)
        this.contentChanged(created, false)
        await this.saveAndTell(project.path)
        this.followAll()
        return { element: await this.view(project, created) }
      }
      case 'close': {
        const { created, project } = this.createdTarget(caller, request.element)
        project.elements.splice(project.elements.indexOf(created), 1)
        if (!project.elements.length) delete this.state!.projects[pathKey(project.path)]
        await this.saveAndTell(project.path)
        this.followAll()
        return {}
      }
      case 'seen': {
        userOnly()
        // ClaudeForge's own Elements never ask for attention.
        if (typeof request.element === 'string' && isOwnElement(request.element)) return {}
        const { created, project } = this.createdTarget(caller, request.element)
        if (created.attention === null) return {}
        created.attention = null
        await this.saveAndTell(project.path)
        return {}
      }
      case 'read-file': {
        const item = this.fileItem(caller, request.element, request.item)
        const file = await fileState(item.path)
        return { file, text: await fileText(item.path, file) }
      }
      case 'open-file': {
        userOnly()
        const item = this.fileItem(caller, request.element, request.item)
        if (!opensAsDocument(item.path)) return refuse({ code: 'not-a-document', path: item.path })
        await this.options.openFile(item.path)
        return {}
      }
      case 'restore-default':
        userOnly()
        return this.restoreDefault()
      default:
        return refuse({ code: 'bad-request' })
    }
  }

  private async create(caller: Caller, request: Extract<ElementRequest, { op: 'create' }>): Promise<ElementView> {
    const { kind, name, title } = request
    if (!(CREATED_KINDS as readonly unknown[]).includes(kind)) return refuse({ code: 'bad-kind', kind: String(kind) })
    if (typeof name !== 'string' || !isElementName(kind, name)) return refuse({ code: 'bad-name', name: String(name) })
    const badTitle = title === undefined ? null : propertyValueRefusal('title', title, null)
    if (badTitle || title === null) return refuse(badTitle ?? { code: 'bad-request' })
    if (caller.project === null) return refuse({ code: 'no-project' })
    const key = pathKey(caller.project)
    const project = (this.state!.projects[key] ??= { path: caller.project, elements: [] })
    if (project.elements.some((each) => each.kind === kind && each.name === name))
      return refuse({ code: 'name-taken', element: elementId(kind, name) })

    // After every other Element of its container, ClaudeForge's own included.
    const container = CONTAINER_OF[kind]
    const views = await this.views(caller.project)
    const orders = views.filter((view) => view.container === container).map((view) => view.properties.order ?? 0)
    const created: StoredElement = {
      kind,
      name,
      properties: createdProperties(kind, name, Math.max(0, ...orders) + 1),
      items: [],
      attention: 'front'
    }
    if (title !== undefined && 'title' in created.properties) created.properties.title = title.trim()
    project.elements.push(created)
    await this.saveAndTell(project.path)
    return this.view(project, created)
  }

  private async set(caller: Caller, element: string, properties: unknown): Promise<ElementView> {
    const target = this.target(caller, element)
    if (!isRecord(properties)) return refuse({ code: 'bad-request' })
    const takes = 'own' in target ? PROPERTIES_TAKEN[target.own] : PROPERTIES_TAKEN[target.created.kind]
    const bounds = 'own' in target ? widthBounds(target.own) : null
    // Every property is checked before any changes.
    for (const [name, value] of Object.entries(properties)) {
      if (!(PROPERTIES as readonly string[]).includes(name)) return refuse({ code: 'unknown-property', property: name })
      const property = name as PropertyName
      if (!takes.includes(property)) return refuse({ code: 'property-not-taken', element, property, takes })
      const refusal = propertyValueRefusal(property, value, bounds)
      if (refusal) return refuse(refusal)
    }
    const tidied = Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [name, typeof value === 'string' ? value.trim() : value])
    ) as ElementProperties

    if ('created' in target) {
      const { created, project } = target
      // A null title is the Element's name again.
      created.properties = { ...created.properties, ...tidied, ...(tidied.title === null ? { title: created.name } : {}) }
      await this.saveAndTell(project.path)
      return this.view(project, created)
    }

    const { own } = target
    const panel = COLUMN_PANELS[own]
    const { width, collapsed, ...kept } = tidied
    if (panel && (width !== undefined || collapsed !== undefined))
      await this.options.layout.write({ [panel]: { width, collapsed } })
    const next = { ...this.state!.own[own], ...(panel ? kept : tidied) }
    // A default value is no change worth keeping.
    for (const [name, value] of Object.entries(next)) {
      if (value === defaultOwnProperties(own)[name as PropertyName] || value === null) delete next[name as PropertyName]
    }
    if (Object.keys(next).length) this.state!.own[own] = next
    else delete this.state!.own[own]
    await this.saveAndTell(null)
    return this.ownView(own, await this.options.layout.read())
  }

  private async add(caller: Caller, request: Extract<ElementRequest, { op: 'add' }>): Promise<ElementAnswers['add']> {
    const { item } = request
    if (!isRecord(item) || !(CONTENT_KINDS as readonly unknown[]).includes(item.kind)) return refuse({ code: 'bad-item', field: 'kind' })
    const target = this.target(caller, request.element)
    const takes = 'own' in target ? [] : CONTENT_TAKEN[target.created.kind]
    if (!takes.includes(item.kind)) return refuse({ code: 'content-not-taken', element: request.element, kind: item.kind, takes })
    const problem = itemProblem(item)
    if (problem) return refuse({ code: 'bad-item', field: problem })
    const { created, project } = target as Extract<Target, { created: StoredElement }>

    const index = item.id === undefined ? -1 : created.items.findIndex((each) => each.id === item.id)
    const id = item.id ?? this.freeId(created, item.kind)
    const stored: StoredItem = { ...tidyItem(item, id), writtenBy: caller.writer }
    if (index >= 0) created.items[index] = stored
    else created.items.push(stored)
    this.contentChanged(created, request.show === true)
    await this.saveAndTell(project.path)
    this.followAll()
    return { element: await this.view(project, created), item: id, replaced: index >= 0 }
  }

  /** The first `<kind>-<n>` no item of the Element holds. */
  private freeId(created: StoredElement, kind: string): string {
    const taken = new Set(created.items.map((item) => item.id))
    let n = 1
    while (taken.has(`${kind}-${n}`)) n++
    return `${kind}-${n}`
  }

  /** A change to an Element's content leaves a mark on it, unless the change asks for it to be shown. */
  private contentChanged(created: StoredElement, show: boolean): void {
    if (show) created.attention = 'front'
    else if (created.attention !== 'front') created.attention = 'mark'
  }

  private async restoreDefault(): Promise<object> {
    const state = this.state!
    state.own = {}
    await this.options.layout.write({
      explorer: { width: PANEL_BOUNDS.explorer.default, collapsed: false },
      map: { width: PANEL_BOUNDS.map.default, collapsed: false }
    })
    for (const project of Object.values(state.projects)) {
      for (const created of project.elements) {
        const shown = pick({ visible: true, collapsed: false }, PROPERTIES_TAKEN[created.kind])
        created.properties = { ...created.properties, ...shown }
      }
    }
    await this.save()
    this.options.onChange(null)
    for (const project of Object.values(state.projects)) this.options.onChange(project.path)
    return {}
  }

  /** The Element a request names, within what the caller reaches. */
  private target(caller: Caller, element: unknown): Target {
    if (typeof element !== 'string') return refuse({ code: 'bad-request' })
    if (isOwnElement(element)) return { own: element }
    const parsed = parseElementId(element)
    if (!parsed) return refuse({ code: 'unknown-element', element })
    if (caller.project === null) return refuse({ code: 'no-project' })
    const project = this.state!.projects[pathKey(caller.project)]
    const created = project?.elements.find((each) => each.kind === parsed.kind && each.name === parsed.name)
    if (!project || !created) return refuse({ code: 'unknown-element', element })
    return { created, project }
  }

  /** A Created Element a request names; one of ClaudeForge's own is refused as given, else as not created. */
  private createdTarget(caller: Caller, element: unknown, refusal?: ElementRefusal): Extract<Target, { created: StoredElement }> {
    const target = this.target(caller, element)
    if ('own' in target) return refuse(refusal ?? { code: 'not-created', element: target.own })
    return target
  }

  private fileItem(caller: Caller, element: string, item: unknown): Extract<StoredItem, { kind: 'file' }> {
    const { created } = this.createdTarget(caller, element, { code: 'unknown-item', element, item: String(item) })
    const found = created.items.find((each) => each.id === item)
    if (!found) return refuse({ code: 'unknown-item', element, item: String(item) })
    if (found.kind !== 'file') return refuse({ code: 'not-a-file', element, item: found.id })
    return found
  }

  /** ClaudeForge's own Elements, then the Project's Created Elements as they were created. */
  private async views(project: string | null): Promise<ElementView[]> {
    const layout = await this.options.layout.read()
    const own = OWN_ELEMENTS.map((id) => this.ownView(id, layout))
    const stored = project === null ? undefined : this.state!.projects[pathKey(project)]
    if (!stored) return own
    return [...own, ...(await Promise.all(stored.elements.map((created) => this.view(stored, created))))]
  }

  private ownView(id: OwnElementId, layout: AppState['layout']): ElementView {
    const panel = COLUMN_PANELS[id]
    const properties = { ...defaultOwnProperties(id), ...this.state!.own[id] }
    if (panel) Object.assign(properties, { width: layout[panel].width, collapsed: layout[panel].collapsed })
    return {
      id,
      project: null,
      kind: null,
      container: OWN_CONTAINERS[id] ?? null,
      properties: pick(properties, PROPERTIES_TAKEN[id]),
      takes: PROPERTIES_TAKEN[id],
      contentKinds: [],
      items: [],
      attention: null
    }
  }

  private async view(project: StoredProject, created: StoredElement): Promise<ElementView> {
    const items: ContentItem[] = await Promise.all(
      created.items.map(async (item) => (item.kind === 'file' ? { ...item, file: await fileState(item.path) } : { ...item }))
    )
    return {
      id: elementId(created.kind, created.name),
      project: project.path,
      kind: created.kind,
      container: CONTAINER_OF[created.kind],
      properties: { ...created.properties },
      takes: PROPERTIES_TAKEN[created.kind],
      contentKinds: CONTENT_TAKEN[created.kind],
      items,
      attention: created.attention
    }
  }

  /**
   * Follows the file of every file Content item, and no other: a change to one, or its going
   * missing or coming back, marks its Element and says so.
   */
  private followAll(): void {
    if (this.disposed) return
    const wanted = new Map<string, { path: string; project: string; element: string; item: string }>()
    for (const project of Object.values(this.state!.projects)) {
      for (const created of project.elements) {
        for (const item of created.items) {
          if (item.kind !== 'file') continue
          const element = elementId(created.kind, created.name)
          wanted.set(JSON.stringify([pathKey(project.path), element, item.id, item.path]), {
            path: item.path,
            project: project.path,
            element,
            item: item.id
          })
        }
      }
    }
    for (const [key, { path, listener }] of this.followed) {
      if (wanted.has(key)) continue
      unwatchFile(path, listener)
      this.followed.delete(key)
    }
    for (const [key, file] of wanted) {
      if (this.followed.has(key)) continue
      const listener = (current: Stats, previous: Stats): void => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size && current.nlink === previous.nlink) return
        void this.run(() => this.fileChanged(file.project, file.element, file.item)).catch(() => undefined)
      }
      watchFile(file.path, { interval: this.options.fileInterval ?? 500, persistent: false }, listener)
      this.followed.set(key, { path: file.path, listener })
    }
  }

  private async fileChanged(projectPath: string, element: string, item: string): Promise<void> {
    if (this.disposed) return
    const project = this.state!.projects[pathKey(projectPath)]
    const created = project?.elements.find((each) => elementId(each.kind, each.name) === element)
    if (!project || !created?.items.some((each) => each.id === item)) return
    this.contentChanged(created, false)
    await this.saveAndTell(project.path)
  }

  private async saveAndTell(project: string | null): Promise<void> {
    await this.save()
    this.options.onChange(project)
  }

  private async load(): Promise<ElementsState> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      return emptyState()
    }
    try {
      return readState(JSON.parse(raw))
    } catch {
      // A corrupt file falls back to the Default layout; the next change replaces it.
      return emptyState()
    }
  }

  private async save(): Promise<void> {
    await mkdir(this.options.stateDir, { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8')
    await rename(tmp, this.file)
  }
}
