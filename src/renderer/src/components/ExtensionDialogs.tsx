import { Download, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvailablePluginListing, ExtensionFileKind, McpTransport, NewMcpServer } from '../../../shared/api'
import { isExtensionName } from '../../../shared/frontmatter'
import { api } from '../api'

/** How many matching plugins the install dialog lists; a search narrows the rest down. */
const SHOWN_PLUGINS = 50

/** The words of a command line: split at white space, except within double quotes, which go. */
function commandWords(line: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let quoted = false
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
      word ??= ''
    } else if (!quoted && /\s/.test(char)) {
      if (word !== null) words.push(word)
      word = null
    } else {
      word = (word ?? '') + char
    }
  }
  if (word !== null) words.push(word)
  return words
}

/** The non-blank lines of a text area. */
const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

interface ModalProps {
  title: string
  /** While the change runs, Escape waits. */
  busy: boolean
  /** Shown under the fields when Claude Code refused, leaving the dialog open. */
  error: string | null
  onCancel(): void
  children: ReactNode
}

/** A modal dialog over the Extensions menu; Escape cancels it, except while its change runs. */
function Modal({ title, busy, error, onCancel, children }: ModalProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="cf-dialog extdialog"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 className="cf-dialog__title" id={titleId}>
        {title}
      </h2>
      {children}
      {error && (
        <p className="extdialog__error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  )
}

interface AddMcpServerDialogProps {
  /** The Project it is added to; null for the user's own, in every Project. */
  scopeName: string | null
  busy: boolean
  error: string | null
  onAdd(server: NewMcpServer): void
  onCancel(): void
}

/** Asks what `claude mcp add` needs: a name, and a command to run or a URL to reach. */
export function AddMcpServerDialog({ scopeName, busy, error, onAdd, onCancel }: AddMcpServerDialogProps): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [target, setTarget] = useState('')
  const [extra, setExtra] = useState('')
  const stdio = transport === 'stdio'
  const [command, ...args] = stdio ? commandWords(target) : [target.trim()]
  const ready = name.trim() !== '' && !!command

  return (
    <Modal
      title={
        scopeName
          ? t('extensions.addMcpServer.titleProject', { project: scopeName })
          : t('extensions.addMcpServer.titleGlobal')
      }
      busy={busy}
      error={error}
      onCancel={onCancel}
    >
      <form
        className="extdialog__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready || busy) return
          onAdd({
            name: name.trim(),
            transport,
            target: command!,
            args,
            env: stdio ? lines(extra) : [],
            headers: stdio ? [] : lines(extra)
          })
        }}
      >
        <label htmlFor={`${id}-name`}>{t('extensions.addMcpServer.name')}</label>
        <input
          id={`${id}-name`}
          className="extdialog__input"
          value={name}
          autoFocus
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor={`${id}-transport`}>{t('extensions.addMcpServer.transport')}</label>
        <select
          id={`${id}-transport`}
          className="extdialog__input"
          value={transport}
          onChange={(event) => setTransport(event.target.value as McpTransport)}
        >
          <option value="stdio">{t('extensions.addMcpServer.stdio')}</option>
          <option value="http">{t('extensions.addMcpServer.http')}</option>
          <option value="sse">{t('extensions.addMcpServer.sse')}</option>
        </select>
        <label htmlFor={`${id}-target`}>{t(`extensions.addMcpServer.${stdio ? 'command' : 'url'}`)}</label>
        <input
          id={`${id}-target`}
          className="extdialog__input cf-mono"
          value={target}
          spellCheck={false}
          placeholder={stdio ? 'npx -y @modelcontextprotocol/server-github' : 'https://example.com/mcp'}
          onChange={(event) => setTarget(event.target.value)}
        />
        <label htmlFor={`${id}-extra`}>{t(`extensions.addMcpServer.${stdio ? 'env' : 'headers'}`)}</label>
        <textarea
          id={`${id}-extra`}
          className="extdialog__input cf-mono"
          rows={3}
          value={extra}
          spellCheck={false}
          placeholder={stdio ? 'API_KEY=…' : 'Authorization: Bearer …'}
          aria-describedby={`${id}-extra-hint`}
          onChange={(event) => setExtra(event.target.value)}
        />
        <span className="extdialog__hint" id={`${id}-extra-hint`}>
          {t(`extensions.addMcpServer.${stdio ? 'envHint' : 'headersHint'}`)}
        </span>
        <div className="cf-dialog__actions">
          <button type="button" className="cf-btn" disabled={busy} onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="cf-btn cf-btn--primary" disabled={busy || !ready}>
            <Plus className="cf-icon" aria-hidden="true" />
            {t('extensions.addMcpServer.action')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface InstallPluginDialogProps {
  project: string
  /** The Project it is installed in; null for the user's own, in every Project. */
  scopeName: string | null
  busy: boolean
  error: string | null
  /** Installs the plugin of that id. */
  onInstall(plugin: string): void
  onCancel(): void
}

/** The configured marketplaces' plugins not installed here yet, searchable, each installed with one click. */
export function InstallPluginDialog({
  project,
  scopeName,
  busy,
  error,
  onInstall,
  onCancel
}: InstallPluginDialogProps): ReactNode {
  const { t } = useTranslation()
  const searchId = useId()
  const [listing, setListing] = useState<AvailablePluginListing | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let current = true
    api.extensions.available(project).then(
      (available) => current && setListing(available),
      () => current && setListing({ plugins: [], problem: 'claude-failed' })
    )
    return () => {
      current = false
    }
  }, [project])

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matching = (listing?.plugins ?? []).filter((plugin) => {
    const text = `${plugin.name} ${plugin.description ?? ''} ${plugin.marketplace}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
  const heading = t('extensions.installPlugin.list')

  return (
    <Modal
      title={
        scopeName
          ? t('extensions.installPlugin.titleProject', { project: scopeName })
          : t('extensions.installPlugin.titleGlobal')
      }
      busy={busy}
      error={error}
      onCancel={onCancel}
    >
      <label className="extdialog__label" htmlFor={searchId}>
        {t('extensions.installPlugin.search')}
      </label>
      <input
        id={searchId}
        className="extdialog__input"
        type="search"
        value={query}
        autoFocus
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
      {listing === null && <p className="extmenu__note">{t('extensions.installPlugin.loading')}</p>}
      {listing?.problem && <p className="extmenu__note extmenu__note--problem">{t('extensions.installPlugin.failed')}</p>}
      {listing && !listing.problem && matching.length === 0 && (
        <p className="extmenu__note">{t('extensions.installPlugin.none')}</p>
      )}
      {matching.length > 0 && (
        <ul className="extdialog__plugins" aria-label={heading}>
          {matching.slice(0, SHOWN_PLUGINS).map((plugin) => (
            <li key={plugin.id} className="cf-row cf-row--two">
              <span className="cf-row__text">
                <span className="cf-row__title">
                  {plugin.name} <span className="cf-chip">{plugin.marketplace}</span>
                </span>
                {plugin.description && <span className="cf-row__sub">{plugin.description}</span>}
              </span>
              <button
                type="button"
                className="cf-btn cf-btn--ghost"
                aria-label={t('extensions.installPlugin.action', { name: plugin.name })}
                disabled={busy}
                onClick={() => onInstall(plugin.id)}
              >
                <Download className="cf-icon cf-icon--sm" aria-hidden="true" />
                {t('extensions.installPlugin.install')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {matching.length > SHOWN_PLUGINS && (
        <p className="extdialog__hint">
          {t('extensions.installPlugin.more', { shown: SHOWN_PLUGINS, count: matching.length })}
        </p>
      )}
      <div className="cf-dialog__actions">
        <button type="button" className="cf-btn" disabled={busy} onClick={onCancel}>
          {t('dialog.close')}
        </button>
      </div>
    </Modal>
  )
}

interface NewExtensionFileDialogProps {
  kind: ExtensionFileKind
  /** The Project it is created in; null for the user's own, in every Project. */
  scopeName: string | null
  busy: boolean
  error: string | null
  onCreate(name: string): void
  onCancel(): void
}

/** Asks for a new skill's or subagent's name, which names its file too, then creates it from the template. */
export function NewExtensionFileDialog({
  kind,
  scopeName,
  busy,
  error,
  onCreate,
  onCancel
}: NewExtensionFileDialogProps): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [name, setName] = useState('')
  const ready = isExtensionName(name.trim())

  return (
    <Modal
      title={
        scopeName
          ? t(`extensions.newFile.${kind}.titleProject`, { project: scopeName })
          : t(`extensions.newFile.${kind}.titleGlobal`)
      }
      busy={busy}
      error={error}
      onCancel={onCancel}
    >
      <form
        className="extdialog__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !busy) onCreate(name.trim())
        }}
      >
        <label htmlFor={`${id}-name`}>{t('extensions.newFile.name')}</label>
        <input
          id={`${id}-name`}
          className="extdialog__input cf-mono"
          value={name}
          autoFocus
          spellCheck={false}
          placeholder={kind === 'skill' ? 'menu-planner' : 'api-tester'}
          aria-describedby={`${id}-name-hint`}
          onChange={(event) => setName(event.target.value)}
        />
        <span className="extdialog__hint" id={`${id}-name-hint`}>
          {t('extensions.newFile.nameHint')}
        </span>
        <div className="cf-dialog__actions">
          <button type="button" className="cf-btn" disabled={busy} onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="cf-btn cf-btn--primary" disabled={busy || !ready}>
            <Plus className="cf-icon" aria-hidden="true" />
            {t('extensions.newFile.action')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
