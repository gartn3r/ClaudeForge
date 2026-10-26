import {
  Bot,
  Check,
  CircleAlert,
  CircleHelp,
  CirclePause,
  CircleSlash,
  Plug,
  Plus,
  Puzzle,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type {
  Extension,
  ExtensionChange,
  ExtensionChangeResult,
  ExtensionKind,
  ExtensionListing,
  ExtensionScope,
  McpServerStatus
} from '../../../shared/api'
import { api } from '../api'
import { tabsHosting, type HostedTab } from '../terminal/hosted-sessions'
import { ConfirmDialog } from './ConfirmDialog'
import { AddMcpServerDialog, InstallPluginDialog } from './ExtensionDialogs'

/** The Extensions of a Project: undefined while they are read, 'failed' when they could not be. */
type Loaded = ExtensionListing | 'failed' | undefined

/**
 * The Project's Extensions, read again on `refresh()`, which settles once they are; the last ones
 * read show meanwhile.
 */
function useExtensions(project: string): { listing: Loaded; refresh(): Promise<void> } {
  const [loaded, setLoaded] = useState<{ project: string; listing: ExtensionListing | 'failed' } | null>(null)
  const [round, setRound] = useState(0)
  const waiting = useRef<Array<() => void>>([])
  useEffect(() => {
    let current = true
    const settle = (listing: ExtensionListing | 'failed'): void => {
      if (!current) return
      setLoaded({ project, listing })
      for (const resolve of waiting.current.splice(0)) resolve()
    }
    api.extensions.list(project).then(settle, () => settle('failed'))
    return () => {
      current = false
    }
  }, [project, round])
  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve)
        setRound((previous) => previous + 1)
      }),
    []
  )
  return { listing: loaded?.project === project ? loaded.listing : undefined, refresh }
}

const ICONS: Record<ExtensionKind, LucideIcon> = { skill: Sparkles, subagent: Bot, 'mcp-server': Plug, plugin: Puzzle }

/** The kinds as the bar counts them, and as the menu groups them. */
const BAR_ORDER: ExtensionKind[] = ['skill', 'subagent', 'mcp-server', 'plugin']
const MENU_ORDER: ExtensionKind[] = ['mcp-server', 'skill', 'subagent', 'plugin']

/** Translation keys by kind, under `extensions.count` and `extensions.group`. */
const KEYS = {
  skill: 'skill',
  subagent: 'subagent',
  'mcp-server': 'mcpServer',
  plugin: 'plugin'
} as const satisfies Record<ExtensionKind, string>

interface StatusLook {
  /** Under `extensions.status`. */
  key: string
  icon: LucideIcon
  tone: string
  /** Brings nothing until the user acts: the bar flags it. */
  failing: boolean
  /** What the row says under the server's name: Claude Code's words, or how to sign in. */
  hint: 'detail' | 'signIn' | null
}

const STATUS = {
  connected: { key: 'connected', icon: Check, tone: 'cf-status--done', failing: false, hint: null },
  'needs-sign-in': { key: 'needsSignIn', icon: CircleAlert, tone: 'cf-status--error', failing: true, hint: 'signIn' },
  failed: { key: 'failed', icon: CircleAlert, tone: 'cf-status--error', failing: true, hint: 'detail' },
  'pending-approval': { key: 'pendingApproval', icon: CirclePause, tone: 'cf-status--waiting', failing: false, hint: null },
  disabled: { key: 'disabled', icon: CircleSlash, tone: '', failing: false, hint: null },
  unknown: { key: 'unknown', icon: CircleHelp, tone: '', failing: false, hint: 'detail' }
} as const satisfies Record<McpServerStatus, StatusLook>

const GAP = 8

/** Where the menu opens: above the bar, from the explorer's left edge, as far up as the title bar. */
function placeAbove(bar: HTMLElement): CSSProperties {
  const { left, top } = bar.getBoundingClientRect()
  const ceiling = document.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 0
  return {
    left: left + GAP,
    bottom: innerHeight - top + GAP,
    maxHeight: top - ceiling - 2 * GAP,
    maxWidth: innerWidth - left - 2 * GAP
  }
}

/** An MCP server that brings nothing until the user acts: it failed, or waits for sign-in. */
const failing = (extension: Extension): boolean => !!extension.mcp && STATUS[extension.mcp.status].failing

/** The last segment of a Project's path, as the explorer names it. */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

interface ExtensionsBarProps {
  /** The displayed Session's Project, whose Extensions it counts. */
  project: string
  /** The Hosted sessions' tabs, for the notice naming those still on the previous setup. */
  hostedTabs: HostedTab[]
  onShowHostedSession(key: string): void
}

/** Docked under the explorer: one count per kind of Extension, opening the Extensions menu. */
export function ExtensionsBar({ project, hostedTabs, onShowHostedSession }: ExtensionsBarProps): ReactNode {
  const { t } = useTranslation()
  const { listing, refresh } = useExtensions(project)
  /** Where the open menu sits; null while it is closed. */
  const [placement, setPlacement] = useState<CSSProperties | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const extensions = typeof listing === 'object' ? listing.extensions : null
  const close = useCallback((refocus: boolean) => {
    setPlacement(null)
    if (refocus) button.current?.focus()
  }, [])
  // Opening the menu checks the MCP servers again.
  const toggle = (bar: HTMLElement): void => {
    if (placement) return close(false)
    setPlacement(placeAbove(bar))
    void refresh()
  }

  const counts = BAR_ORDER.map((kind) => {
    const ofKind = extensions?.filter((extension) => extension.kind === kind) ?? []
    const failingCount = ofKind.filter(failing).length
    const label = [
      t(`extensions.count.${KEYS[kind]}`, { count: ofKind.length }),
      ...(failingCount > 0 ? [t('extensions.count.failing', { count: failingCount })] : [])
    ].join(' ')
    return { kind, count: ofKind.length, failing: failingCount > 0, label }
  })

  return (
    <section className="extbar" aria-label={t('extensions.heading')}>
      <button
        type="button"
        ref={button}
        className="extbar__button"
        aria-haspopup="dialog"
        aria-expanded={placement !== null}
        aria-busy={listing === undefined}
        aria-label={
          extensions
            ? t('extensions.summary', { counts: counts.map(({ label }) => label).join(', ') })
            : t('extensions.heading')
        }
        onClick={(event) => toggle(event.currentTarget)}
      >
        <span className="cf-eyebrow">{t('extensions.heading')}</span>
        {extensions &&
          counts.map(({ kind, count, failing, label }) => {
            const Icon = failing ? CircleAlert : ICONS[kind]
            return (
              <span key={kind} className={`extbar__count${failing ? ' extbar__count--failing' : ''}`} title={label}>
                <Icon className="cf-icon cf-icon--sm" aria-hidden="true" />
                {count}
              </span>
            )
          })}
      </button>
      {placement && (
        <ExtensionsPopover
          project={project}
          listing={listing}
          refresh={refresh}
          hostedTabs={hostedTabs}
          onShowHostedSession={onShowHostedSession}
          placement={placement}
          anchor={button}
          onClose={close}
        />
      )}
    </section>
  )
}

interface ExtensionsPopoverProps {
  project: string
  listing: Loaded
  /** Reads the Extensions again; settles once they are. */
  refresh(): Promise<void>
  hostedTabs: HostedTab[]
  onShowHostedSession(key: string): void
  placement: CSSProperties
  /** The bar's button, which toggles the menu itself. */
  anchor: RefObject<HTMLButtonElement | null>
  /** Closes the menu; `refocus` gives the focus back to the bar. */
  onClose(refocus: boolean): void
}

/** What asks the user before a change: removing or uninstalling one Extension, adding, installing. */
type Asking = { kind: 'remove'; extension: Extension } | { kind: 'add-mcp-server' } | { kind: 'install-plugin' }

/** The change that removes an Extension: uninstalling a plugin, or removing an MCP server. */
function removal(extension: Extension): ExtensionChange | null {
  if (extension.install) return { action: 'uninstall-plugin', plugin: extension.install }
  if (extension.removable) return { action: 'remove-mcp-server', name: extension.name, scope: extension.scope }
  return null
}

/** Under `extensions.remove`: what removing it is called. */
const removalKey = (extension: Extension): 'plugin' | 'mcpServer' => (extension.install ? 'plugin' : 'mcpServer')

/**
 * The Extensions menu: every Extension of one scope, grouped by kind. Plugins switch on and off;
 * MCP servers and plugins are added and removed, each change through Claude Code's CLI, one at a time.
 */
function ExtensionsPopover({
  project,
  listing,
  refresh,
  hostedTabs,
  onShowHostedSession,
  placement,
  anchor,
  onClose
}: ExtensionsPopoverProps): ReactNode {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [scope, setScope] = useState<ExtensionScope>('project')
  /** A change runs, then the Extensions are read again: everything that changes them waits. */
  const [busy, setBusy] = useState(false)
  /** Claude Code's words on the last toggle it refused. */
  const [error, setError] = useState<string | null>(null)
  /** A change went through since the menu opened. */
  const [changed, setChanged] = useState(false)
  const [asking, setAsking] = useState<Asking | null>(null)
  /** Claude Code's words on the last change a dialog asked for. */
  const [askError, setAskError] = useState<string | null>(null)

  const apply = async (change: ExtensionChange): Promise<ExtensionChangeResult> => {
    setBusy(true)
    try {
      const result = await api.extensions
        .change(project, change)
        .catch((failure: unknown): ExtensionChangeResult => ({ ok: false, error: String(failure) }))
      if (result.ok) {
        setChanged(true)
        await refresh()
      }
      return result
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (plugin: Extension): Promise<void> => {
    setError(null)
    const result = await apply({ action: plugin.enabled ? 'disable-plugin' : 'enable-plugin', plugin: plugin.install! })
    if (!result.ok) setError(result.error)
  }

  const ask = (asked: Asking): void => {
    setAskError(null)
    setAsking(asked)
  }
  /** Makes the change a dialog asked for; the dialog closes once it went through, else says why not. */
  const applyAsked = async (change: ExtensionChange): Promise<void> => {
    setAskError(null)
    const result = await apply(change)
    if (result.ok) setAsking(null)
    else setAskError(result.error)
  }

  useEffect(() => {
    // While a change runs the menu stays, to show how it went.
    if (busy) return
    const onKey = (event: KeyboardEvent): void => {
      // A dialog over the menu takes its own Escape.
      if (event.key === 'Escape' && !ref.current?.querySelector('dialog[open]')) onClose(true)
    }
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose(false)
    }
    const onResize = (): void => onClose(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor, onClose, busy])

  const inScope = typeof listing === 'object' ? listing.extensions.filter((extension) => extension.scope === scope) : []
  const projectName = folderName(project)
  const scopeName = scope === 'project' ? projectName : null
  const outdated = typeof listing === 'object' ? listing.outdatedSessions : []
  const outdatedTabs = tabsHosting(hostedTabs, outdated).filter(({ end }) => !end)
  const removing = asking?.kind === 'remove' ? asking.extension : null
  const removingChange = removing && removal(removing)

  return createPortal(
    <div
      ref={ref}
      className="cf-popover extmenu"
      role="dialog"
      aria-label={t('extensions.heading')}
      aria-busy={busy}
      style={placement}
    >
      <div className="extmenu__head">
        <span className="cf-eyebrow">{t('extensions.heading')}</span>
        <div className="cf-seg" role="group" aria-label={t('extensions.scope')}>
          <button type="button" aria-pressed={scope === 'global'} onClick={() => setScope('global')}>
            {t('extensions.global')}
          </button>
          <button
            type="button"
            aria-pressed={scope === 'project'}
            autoFocus
            title={project}
            onClick={() => setScope('project')}
          >
            {t('extensions.thisProject', { project: projectName })}
          </button>
        </div>
      </div>
      {listing === undefined && <p className="extmenu__note">{t('extensions.loading')}</p>}
      {listing === 'failed' && <p className="extmenu__note extmenu__note--problem">{t('extensions.loadFailed')}</p>}
      {typeof listing === 'object' && (
        <>
          {listing.problem && <p className="extmenu__note extmenu__note--problem">{t('extensions.claudeFailed')}</p>}
          {error && (
            <p className="extmenu__note extmenu__note--problem" role="alert">
              {error}
            </p>
          )}
          {inScope.length === 0 && (
            <p className="extmenu__note">
              {scope === 'project' ? t('extensions.emptyProject', { project: projectName }) : t('extensions.emptyGlobal')}
            </p>
          )}
          {MENU_ORDER.map((kind) => {
            const rows = inScope.filter((extension) => extension.kind === kind)
            if (rows.length === 0) return null
            const heading = t(`extensions.group.${KEYS[kind]}`)
            return (
              <div key={kind} className="extmenu__group">
                <span className="cf-eyebrow">{heading}</span>
                <ul aria-label={heading}>
                  {rows.map((extension) => (
                    <ExtensionRow
                      key={`${extension.plugin ?? ''}/${extension.name}`}
                      extension={extension}
                      busy={busy}
                      onToggle={() => void toggle(extension)}
                      onRemove={() => ask({ kind: 'remove', extension })}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
          {(changed || outdatedTabs.length > 0) && (
            <div className="extmenu__notice" role="status">
              <CircleAlert className="cf-icon cf-icon--sm" aria-hidden="true" />
              <div>
                <p>
                  {t('extensions.notice.newSessions')}
                  {outdatedTabs.length > 0 && ` ${t('extensions.notice.outdated', { count: outdatedTabs.length })}`}
                </p>
                {outdatedTabs.length > 0 && (
                  <ul>
                    {outdatedTabs.map((tab) => (
                      <li key={tab.key}>
                        <button type="button" className="lnk" onClick={() => onShowHostedSession(tab.key)}>
                          {tab.title ?? folderName(tab.project)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <div className="extmenu__foot">
            <button type="button" className="cf-btn" disabled={busy} onClick={() => ask({ kind: 'add-mcp-server' })}>
              <Plus className="cf-icon cf-icon--sm" aria-hidden="true" />
              {t('extensions.addMcpServer.open')}
            </button>
            <button
              type="button"
              className="cf-btn cf-btn--ghost"
              disabled={busy}
              onClick={() => ask({ kind: 'install-plugin' })}
            >
              {t('extensions.installPlugin.open')}
            </button>
          </div>
        </>
      )}
      {removing && removingChange && (
        <ConfirmDialog
          title={t(`extensions.remove.${removalKey(removing)}.title`, { name: removing.name })}
          actionLabel={t(`extensions.remove.${removalKey(removing)}.action`)}
          actionIcon={Trash2}
          error={askError}
          busy={busy}
          onConfirm={() => void applyAsked(removingChange)}
          onCancel={() => setAsking(null)}
        >
          <p>
            {t(`extensions.remove.${removalKey(removing)}.body`, {
              scope: removing.scope === 'project' ? projectName : t('extensions.global')
            })}
          </p>
          {/* A Project's shared setup is committed with it: the change reaches everyone working on it. */}
          {(removing.install?.scope === 'project' || (removing.removable && removing.scope === 'project')) && (
            <p>{t(`extensions.remove.${removalKey(removing)}.shared`)}</p>
          )}
        </ConfirmDialog>
      )}
      {asking?.kind === 'add-mcp-server' && (
        <AddMcpServerDialog
          scopeName={scopeName}
          busy={busy}
          error={askError}
          onAdd={(server) => void applyAsked({ action: 'add-mcp-server', server, scope })}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking?.kind === 'install-plugin' && (
        <InstallPluginDialog
          project={project}
          scopeName={scopeName}
          busy={busy}
          error={askError}
          onInstall={(plugin) => void applyAsked({ action: 'install-plugin', plugin, scope })}
          onCancel={() => setAsking(null)}
        />
      )}
    </div>,
    document.body
  )
}

interface ExtensionRowProps {
  extension: Extension
  /** A change runs: the row's controls wait. */
  busy: boolean
  /** Switches a plugin on or off. */
  onToggle(): void
  /** Asks to remove an MCP server or uninstall a plugin. */
  onRemove(): void
}

function ExtensionRow({ extension, busy, onToggle, onRemove }: ExtensionRowProps): ReactNode {
  const { t } = useTranslation()
  const Icon = ICONS[extension.kind]
  const { mcp } = extension
  const status = mcp && STATUS[mcp.status]
  const StatusIcon = status?.icon
  const off = extension.enabled === false || mcp?.status === 'disabled'
  const hints = { detail: mcp?.detail, signIn: t('extensions.signInHint') }
  const sub = extension.enabled === false ? t('extensions.pluginDisabled') : status?.hint ? hints[status.hint] : null
  const origin = extension.plugin ?? t(`extensions.origin.${extension.scope}`)
  return (
    <li className={`cf-row${sub ? ' cf-row--two' : ''}`} title={extension.description ?? undefined}>
      <Icon className="cf-icon" aria-hidden="true" />
      <span className="cf-row__text">
        <span className={`cf-row__title${off ? ' cf-muted' : ''}`}>{extension.name}</span>
        {sub && <span className={`cf-row__sub${failing(extension) ? ' extmenu__problem' : ''}`}>{sub}</span>}
      </span>
      {removal(extension) && (
        <button
          type="button"
          className="cf-btn cf-btn--ghost cf-btn--icon extmenu__action"
          aria-label={t(`extensions.remove.${removalKey(extension)}.open`, { name: extension.name })}
          title={t(`extensions.remove.${removalKey(extension)}.open`, { name: extension.name })}
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 className="cf-icon cf-icon--sm" aria-hidden="true" />
        </button>
      )}
      <span className="cf-chip">{origin}</span>
      {status && StatusIcon && (
        <span
          className={`cf-status ${status.tone}`}
          role="img"
          aria-label={t(`extensions.status.${status.key}`)}
          title={t(`extensions.status.${status.key}`)}
        >
          <StatusIcon className="cf-icon cf-icon--sm" aria-hidden="true" />
        </span>
      )}
      {extension.install && (
        <button
          type="button"
          className="cf-toggle"
          role="switch"
          aria-checked={extension.enabled === true}
          aria-label={t('extensions.enable', { name: extension.name })}
          disabled={busy}
          onClick={onToggle}
        />
      )}
    </li>
  )
}
