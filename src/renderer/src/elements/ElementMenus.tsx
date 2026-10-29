import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  EyeOff,
  Paintbrush,
  Pencil,
  Plus,
  Trash2,
  Type,
  X,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ELEMENT_NAME_MAX_LENGTH,
  ELEMENT_TITLE_MAX_LENGTH,
  isColor,
  isElementName,
  isOwnElement,
  itemProblem,
  type ContentItem,
  type ContentItemInput,
  type ContentKind,
  type CreatedElementKind,
  type ElementRefusal,
  type ElementRequest,
  type ElementView,
  type ItemField,
  type OwnElementId
} from '../../../shared/elements'
import { api } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { folderName } from '../components/ExtensionsMenu'
import { Menu, type MenuItem } from '../components/Menu'
import {
  closeRequest,
  collapseRequest,
  colorRequest,
  createRequest,
  elementMenuKeys,
  hideRequest,
  itemMenuKeys,
  itemRequest,
  moveRequests,
  nameFromTitle,
  removeRequest,
  renameRequest,
  shortcutOf,
  type ElementMenuKey,
  type ItemMenuKey
} from './element-menus'

type Translate = ReturnType<typeof useTranslation>['t']

/** ClaudeForge's own word for each of its own Elements. */
const OWN_NAMES = {
  'title-bar': 'elements.own.titleBar',
  explorer: 'elements.own.explorer',
  shortcuts: 'elements.own.shortcuts',
  sessions: 'elements.own.sessions',
  extensions: 'elements.own.extensions',
  'terminal-area': 'elements.own.terminalArea',
  'right-panel': 'elements.own.rightPanel',
  'panel-tab:map': 'elements.own.mapTab'
} as const satisfies Record<OwnElementId, string>

/** What an Element is called in the interface's words: its title, else ClaudeForge's own word for it. */
export const nameOf = (element: ElementView, t: Translate): string =>
  element.properties.title ?? (isOwnElement(element.id) ? t(OWN_NAMES[element.id]) : element.id)

/** Asks the contract; a refusal comes back to say in the dialog, a failure as a refusal of the request. */
async function ask(request: ElementRequest): Promise<ElementRefusal | null> {
  try {
    const result = await api.elements.request(request)
    return result.ok ? null : result.refusal
  } catch {
    return { code: 'bad-request' }
  }
}

/** Asks the contract each request in turn, stopping at the first refused. */
async function askAll(requests: ElementRequest[]): Promise<ElementRefusal | null> {
  for (const request of requests) {
    const refused = await ask(request)
    if (refused) return refused
  }
  return null
}

/** A refusal in the interface's language. */
function useRefusalText(): (refusal: ElementRefusal) => string {
  const { t } = useTranslation()
  return (refusal) => {
    if (refusal.code === 'bad-item') return t(`elements.itemProblem.${refusal.field}`)
    const values = Object.fromEntries(
      Object.entries(refusal).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])
    )
    return t(`elements.refusal.${refusal.code}`, values)
  }
}

const copy = (text: string): void => void navigator.clipboard.writeText(text).catch(() => undefined)

/** Where a menu is: open, closing (the parent's to unmount it), or one of its dialogs. */
type Step<D extends string> = 'menu' | 'done' | D

/**
 * Closes the menu, then calls the parent back once nothing more is on show. Menu calls its own
 * close before the menu item chosen, so one opening a dialog wins over the close.
 */
function useSteps<D extends string>(onClose: () => void): [Step<D>, (step: Step<D>) => void, () => void] {
  const [step, setStep] = useState<Step<D>>('menu')
  useEffect(() => {
    if (step === 'done') onClose()
  }, [step, onClose])
  const closeMenu = (): void => setStep((current) => (current === 'menu' ? 'done' : current))
  return [step, setStep, closeMenu]
}

interface ElementMenuProps {
  element: ElementView
  /** Where it opens: the pointer, in viewport pixels. */
  at: { x: number; y: number }
  /** The Elements of its container, in their order, to move it among; without them it does not move. */
  siblings?: readonly ElementView[]
  /** Once the menu and any dialog it opened are gone. */
  onClose(): void
}

const ELEMENT_ICONS: Record<ElementMenuKey, LucideIcon> = {
  rename: Pencil,
  'text-color': Type,
  'background-color': Paintbrush,
  'add-item': Plus,
  collapse: ChevronsDownUp,
  expand: ChevronsUpDown,
  'move-up': ArrowUp,
  'move-down': ArrowDown,
  hide: EyeOff,
  'copy-id': Copy,
  close: X
}

const ELEMENT_LABELS = {
  rename: 'elements.menu.rename',
  'text-color': 'elements.menu.textColor',
  'background-color': 'elements.menu.backgroundColor',
  'add-item': 'elements.menu.addItem',
  collapse: 'elements.menu.collapse',
  expand: 'elements.menu.expand',
  'move-up': 'elements.menu.moveUp',
  'move-down': 'elements.menu.moveDown',
  hide: 'elements.menu.hide',
  'copy-id': 'elements.menu.copyId',
  close: 'elements.menu.close'
} as const satisfies Record<ElementMenuKey, string>

/**
 * The right-click menu of an Element: rename, text colour, background colour, add a Content item,
 * collapse or expand, move, hide, copy its identifier, and close a Created Element; each as far as the
 * Element takes it, each through the Elements contract.
 */
export function ElementMenu({ element, at, siblings, onClose }: ElementMenuProps): ReactNode {
  const { t } = useTranslation()
  const [step, setStep, closeMenu] = useSteps<'rename' | 'text-color' | 'background-color' | 'add-item' | 'close'>(onClose)
  const done = (): void => setStep('done')

  const run: Record<ElementMenuKey, () => void> = {
    rename: () => setStep('rename'),
    'text-color': () => setStep('text-color'),
    'background-color': () => setStep('background-color'),
    'add-item': () => setStep('add-item'),
    collapse: () => void ask(collapseRequest(element, true)).finally(done),
    expand: () => void ask(collapseRequest(element, false)).finally(done),
    'move-up': () => void askAll(moveRequests(siblings ?? [], element, -1)).finally(done),
    'move-down': () => void askAll(moveRequests(siblings ?? [], element, 1)).finally(done),
    hide: () => void ask(hideRequest(element)).finally(done),
    'copy-id': () => {
      copy(element.id)
      done()
    },
    close: () => setStep('close')
  }
  const items: MenuItem[] = elementMenuKeys(element, siblings).map((key) => ({
    label: t(ELEMENT_LABELS[key]),
    icon: ELEMENT_ICONS[key],
    danger: key === 'close',
    separated: key === 'hide' || key === 'close',
    onSelect: run[key]
  }))

  switch (step) {
    case 'menu':
      return <Menu label={t('elements.menu.label', { name: nameOf(element, t) })} at={at} items={items} onClose={closeMenu} />
    case 'rename':
      return <RenameDialog element={element} onDone={done} />
    case 'text-color':
    case 'background-color':
      return <ColorDialog element={element} property={step === 'text-color' ? 'textColor' : 'backgroundColor'} onDone={done} />
    case 'add-item':
      return <ItemDialog element={element} editing={null} onDone={done} />
    case 'close':
      return <CloseDialog element={element} onDone={done} />
    case 'done':
      return null
  }
}

interface ContentItemMenuProps {
  element: ElementView
  item: ContentItem
  at: { x: number; y: number }
  onClose(): void
}

const ITEM_ICONS: Record<ItemMenuKey, LucideIcon> = {
  'keep-as-shortcut': Bookmark,
  edit: Pencil,
  'copy-id': Copy,
  remove: Trash2
}

const ITEM_LABELS = {
  'keep-as-shortcut': 'elements.itemMenu.keepAsShortcut',
  edit: 'elements.itemMenu.edit',
  'copy-id': 'elements.itemMenu.copyId',
  remove: 'elements.itemMenu.remove'
} as const satisfies Record<ItemMenuKey, string>

/**
 * Keeps a link or an action as a Shortcut, after the others: a copy, which lives apart from it from
 * then on.
 */
async function keepAsShortcut(item: ContentItem): Promise<void> {
  const shortcut = shortcutOf(item, crypto.randomUUID())
  if (!shortcut) return
  const { shortcuts } = await api.appState.read()
  await api.appState.write({ shortcuts: [...shortcuts, shortcut] })
}

/** The right-click menu of a Content item: Keep as Shortcut (a link or an action), edit, copy its identifier, remove. */
export function ContentItemMenu({ element, item, at, onClose }: ContentItemMenuProps): ReactNode {
  const { t } = useTranslation()
  const [step, setStep, closeMenu] = useSteps<'edit'>(onClose)
  const done = (): void => setStep('done')

  const run: Record<ItemMenuKey, () => void> = {
    'keep-as-shortcut': () => void keepAsShortcut(item).catch(() => undefined).finally(done),
    edit: () => setStep('edit'),
    'copy-id': () => {
      copy(item.id)
      done()
    },
    remove: () => void ask(removeRequest(element, item)).finally(done)
  }
  const items: MenuItem[] = itemMenuKeys(item).map((key) => ({
    label: t(ITEM_LABELS[key]),
    icon: ITEM_ICONS[key],
    danger: key === 'remove',
    separated: key === 'remove',
    onSelect: run[key]
  }))

  if (step === 'menu') return <Menu label={t('elements.itemMenu.label')} at={at} items={items} onClose={closeMenu} />
  if (step === 'edit') return <ItemDialog element={element} editing={item} onDone={done} />
  return null
}

interface FormDialogProps {
  title: string
  submitLabel: string
  /** Said under the fields, from the form's own checks or the contract's refusal. */
  error: string | null
  busy: boolean
  onSubmit(): void
  onCancel(): void
  children: ReactNode
  /** A button beside Cancel, such as "Default colour". */
  extra?: ReactNode
}

/** A modal form over the window: Escape and Cancel close it unchanged. */
export function FormDialog({ title, submitLabel, error, busy, onSubmit, onCancel, children, extra }: FormDialogProps): ReactNode {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!busy) onSubmit()
  }

  return (
    <dialog
      ref={dialog}
      className="cf-dialog element-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
      // A right-click in the form is the form's, never the Element's around it.
      onContextMenu={(event) => event.stopPropagation()}
    >
      <form className="element-dialog__form" noValidate onSubmit={submit}>
        <h2 className="cf-dialog__title" id={`${id}-title`}>
          {title}
        </h2>
        <div className="element-dialog__body">{children}</div>
        {error && (
          <p className="element-dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="cf-dialog__actions">
          {extra}
          <button type="button" className="cf-btn" disabled={busy} onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="cf-btn cf-btn--primary" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** Sends a request from a dialog: it closes once the contract took it, else says why it was refused. */
export function useSubmit(onDone: () => void): {
  busy: boolean
  refusal: string | null
  send(request: ElementRequest): void
  setRefusal(text: string | null): void
} {
  const refusalText = useRefusalText()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const send = (request: ElementRequest): void => {
    setBusy(true)
    void ask(request).then((refused) => {
      setBusy(false)
      if (refused) setRefusal(refusalText(refused))
      else onDone()
    })
  }
  return { busy, refusal, send, setRefusal }
}

function RenameDialog({ element, onDone }: { element: ElementView; onDone(): void }): ReactNode {
  const { t } = useTranslation()
  const [title, setTitle] = useState(element.properties.title ?? '')
  const { busy, refusal, send } = useSubmit(onDone)
  return (
    <FormDialog
      title={t('elements.rename.title', { name: nameOf(element, t) })}
      submitLabel={t('elements.rename.save')}
      error={refusal}
      busy={busy}
      onSubmit={() => send(renameRequest(element, title))}
      onCancel={onDone}
    >
      <label className="element-dialog__field">
        <span>{t('elements.rename.label')}</span>
        <input
          className="extdialog__input"
          value={title}
          maxLength={ELEMENT_TITLE_MAX_LENGTH}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
        <span className="extdialog__hint">{t('elements.rename.hint')}</span>
      </label>
    </FormDialog>
  )
}

/** Any colour: picked, or typed as any CSS colour; or the design's own again. */
function ColorDialog({
  element,
  property,
  onDone
}: {
  element: ElementView
  property: 'textColor' | 'backgroundColor'
  onDone(): void
}): ReactNode {
  const { t } = useTranslation()
  const [color, setColor] = useState(element.properties[property] ?? '')
  const { busy, refusal, send, setRefusal } = useSubmit(onDone)
  const which = property === 'textColor' ? 'text' : 'background'
  const submit = (): void => {
    if (!isColor(color.trim())) return setRefusal(t('elements.color.invalid'))
    send(colorRequest(element, property, color.trim()))
  }
  return (
    <FormDialog
      title={t(`elements.color.${which}Title`, { name: nameOf(element, t) })}
      submitLabel={t('elements.color.save')}
      error={refusal}
      busy={busy}
      onSubmit={submit}
      onCancel={onDone}
      extra={
        <button
          type="button"
          className="cf-btn cf-btn--ghost element-dialog__default"
          disabled={busy}
          onClick={() => send(colorRequest(element, property, null))}
        >
          {t('elements.color.default')}
        </button>
      }
    >
      <div className="element-dialog__color">
        <input
          type="color"
          className="element-dialog__swatch"
          aria-label={t('elements.color.pick')}
          // The picker knows #rrggbb only; any other colour is typed beside it.
          value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}
          onChange={(event) => setColor(event.target.value)}
        />
        <label className="element-dialog__field">
          <span>{t('elements.color.label')}</span>
          <input
            className="extdialog__input cf-mono"
            value={color}
            placeholder="#fde68a"
            spellCheck={false}
            autoFocus
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      </div>
    </FormDialog>
  )
}

function CloseDialog({ element, onDone }: { element: ElementView; onDone(): void }): ReactNode {
  const { t } = useTranslation()
  const { busy, refusal, send } = useSubmit(onDone)
  return (
    <ConfirmDialog
      title={t('elements.close.title', { name: nameOf(element, t) })}
      actionLabel={t('elements.close.action')}
      actionIcon={X}
      error={refusal}
      busy={busy}
      onConfirm={() => send(closeRequest(element))}
      onCancel={onDone}
    >
      <p>{t('elements.close.body')}</p>
    </ConfirmDialog>
  )
}

/** What the form asks for; a Content item's id and kind are not typed. */
type FormField = Exclude<ItemField, 'id' | 'kind'>

/** The fields each kind of Content item is written with, in the form's order. */
const FIELDS: Record<ContentKind, FormField[]> = {
  text: ['text'],
  link: ['title', 'address'],
  file: ['title', 'path'],
  'web-page': ['title', 'address'],
  action: ['title', 'command']
}

type ItemFields = Partial<Record<FormField, string>>

/** The Content item the form holds, as the contract takes it: an empty title is left out. */
function inputOf(kind: ContentKind, id: string | undefined, fields: ItemFields): ContentItemInput {
  const title = fields.title?.trim() ? { title: fields.title } : {}
  const base = id === undefined ? {} : { id }
  switch (kind) {
    case 'text':
      return { ...base, kind, text: fields.text ?? '' }
    case 'link':
    case 'web-page':
      return { ...base, kind, ...title, address: fields.address ?? '' }
    case 'file':
      return { ...base, kind, ...title, path: fields.path ?? '' }
    case 'action':
      return { ...base, kind, ...title, command: fields.command ?? '' }
  }
}

/** A Content item's fields as the form shows them to edit. */
function fieldsOf(item: ContentItem | null): ItemFields {
  if (!item) return {}
  const fields = item as Partial<Record<FormField, string>>
  return Object.fromEntries(FIELDS[item.kind].map((field) => [field, fields[field] ?? '']))
}

/** The hint under a field: a link's address opens in the browser, a web page's shows here. */
const hintKey = (kind: ContentKind, field: FormField) =>
  field === 'address' ? (kind === 'link' ? 'linkAddress' : 'pageAddress') : field

/**
 * Adds a Content item of any kind the Element takes, by hand; or edits one, which adds it again
 * under its id, replacing it.
 */
function ItemDialog({ element, editing, onDone }: { element: ElementView; editing: ContentItem | null; onDone(): void }): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [kind, setKind] = useState<ContentKind>(editing?.kind ?? element.contentKinds[0] ?? 'text')
  const [fields, setFields] = useState<ItemFields>(() => fieldsOf(editing))
  const { busy, refusal, send, setRefusal } = useSubmit(onDone)
  const input = inputOf(kind, editing?.id, fields)

  const submit = (): void => {
    const problem = itemProblem(input)
    if (problem) return setRefusal(t(`elements.itemProblem.${problem}`))
    send(itemRequest(element, input))
  }

  return (
    <FormDialog
      title={t(editing ? 'elements.itemForm.titleEdit' : 'elements.itemForm.titleNew', { name: nameOf(element, t) })}
      submitLabel={t(editing ? 'elements.itemForm.save' : 'elements.itemForm.add')}
      error={refusal}
      busy={busy}
      onSubmit={submit}
      onCancel={onDone}
    >
      {!editing && element.contentKinds.length > 1 && (
        <div className="cf-seg element-dialog__kind" role="group" aria-label={t('elements.itemForm.kind')}>
          {element.contentKinds.map((each) => (
            <button key={each} type="button" aria-pressed={kind === each} onClick={() => setKind(each)}>
              {t(`elements.kinds.${each}`)}
            </button>
          ))}
        </div>
      )}
      {FIELDS[kind].map((field, index) => {
        const props = {
          id: `${id}-${field}`,
          className: field === 'title' || field === 'text' ? 'extdialog__input' : 'extdialog__input cf-mono',
          value: fields[field] ?? '',
          autoFocus: index === 0,
          spellCheck: field === 'title' || field === 'text',
          onChange: (event: { target: { value: string } }) => setFields({ ...fields, [field]: event.target.value })
        }
        return (
          <div key={`${kind}-${field}`} className="element-dialog__field">
            <label htmlFor={props.id}>{t(`elements.itemForm.fields.${field}`)}</label>
            {field === 'text' ? <textarea rows={6} {...props} /> : <input {...props} />}
            <span className="extdialog__hint">{t(`elements.itemForm.hints.${hintKey(kind, field)}`)}</span>
          </div>
        )
      })}
    </FormDialog>
  )
}

/**
 * Creates a Panel tab, a card in the explorer or a menu in the title bar for the displayed Project, by
 * hand: a title, and an identifier unique in the Project, suggested from the title until it is typed.
 * The new Element asks to come to the front itself.
 */
export function CreateElementDialog({
  kind,
  project,
  onDone
}: {
  kind: CreatedElementKind
  project: string
  onDone(): void
}): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [title, setTitle] = useState('')
  const [name, setName] = useState<string | null>(null)
  const { busy, refusal, send, setRefusal } = useSubmit(onDone)
  const shownName = name ?? nameFromTitle(title)
  const submit = (): void => {
    if (!isElementName(kind, shownName.trim())) return setRefusal(t('elements.refusal.bad-name'))
    send(createRequest(kind, project, shownName, title))
  }
  return (
    <FormDialog
      title={t(`elements.create.${kind}`)}
      submitLabel={t('elements.create.action')}
      error={refusal}
      busy={busy}
      onSubmit={submit}
      onCancel={onDone}
    >
      <p className="cf-muted element-dialog__lead">{t('elements.create.inProject', { project: folderName(project) })}</p>
      <label className="element-dialog__field">
        <span>{t('elements.create.title')}</span>
        <input
          className="extdialog__input"
          value={title}
          maxLength={ELEMENT_TITLE_MAX_LENGTH}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="element-dialog__field">
        <label htmlFor={`${id}-name`}>{t('elements.create.name')}</label>
        <span className="element-dialog__prefixed">
          <span className="cf-mono element-dialog__prefix" aria-hidden="true">{`${kind}:`}</span>
          <input
            id={`${id}-name`}
            className="cf-mono"
            value={shownName}
            maxLength={ELEMENT_NAME_MAX_LENGTH}
            spellCheck={false}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setName(event.target.value)}
          />
        </span>
        <span className="extdialog__hint" id={`${id}-hint`}>
          {t('elements.create.nameHint')}
        </span>
      </div>
    </FormDialog>
  )
}
