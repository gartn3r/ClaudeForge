import { Bot, Check, CircleAlert, CirclePause, CircleSlash, Plug, Puzzle, Sparkles, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Extension, ExtensionKind, ExtensionListing, ExtensionScope, McpServerStatus } from '../../../shared/api'
import { api } from '../api'

/** The Extensions of a Project: undefined while they are read, 'failed' when they could not be. */
type Loaded = ExtensionListing | 'failed' | undefined

function useExtensions(project: string): Loaded {
  const [loaded, setLoaded] = useState<{ project: string; listing: ExtensionListing | 'failed' } | null>(null)
  useEffect(() => {
    let current = true
    api.extensions.list(project).then(
      (listing) => current && setLoaded({ project, listing }),
      () => current && setLoaded({ project, listing: 'failed' })
    )
    return () => {
      current = false
    }
  }, [project])
  return loaded?.project === project ? loaded.listing : undefined
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

const STATUS = {
  connected: { key: 'connected', icon: Check, tone: 'cf-status--done' },
  'needs-sign-in': { key: 'needsSignIn', icon: CircleAlert, tone: 'cf-status--error' },
  failed: { key: 'failed', icon: CircleAlert, tone: 'cf-status--error' },
  'pending-approval': { key: 'pendingApproval', icon: CirclePause, tone: 'cf-status--waiting' },
  disabled: { key: 'disabled', icon: CircleSlash, tone: '' }
} as const satisfies Record<McpServerStatus, { key: string; icon: LucideIcon; tone: string }>

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
const failing = (extension: Extension): boolean =>
  extension.mcp?.status === 'failed' || extension.mcp?.status === 'needs-sign-in'

/** The last segment of a Project's path, as the explorer names it. */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

interface ExtensionsBarProps {
  /** The displayed Session's Project, whose Extensions it counts. */
  project: string
}

/** Docked under the explorer: one count per kind of Extension, opening the Extensions menu. */
export function ExtensionsBar({ project }: ExtensionsBarProps): ReactNode {
  const { t } = useTranslation()
  const listing = useExtensions(project)
  /** Where the open menu sits; null while it is closed. */
  const [open, setOpen] = useState<CSSProperties | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const extensions = typeof listing === 'object' ? listing.extensions : null
  const close = useCallback((refocus: boolean) => {
    setOpen(null)
    if (refocus) button.current?.focus()
  }, [])

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
        aria-expanded={open !== null}
        aria-busy={listing === undefined}
        aria-label={
          extensions
            ? t('extensions.summary', { counts: counts.map(({ label }) => label).join(', ') })
            : t('extensions.heading')
        }
        onClick={(event) => setOpen(open ? null : placeAbove(event.currentTarget))}
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
      {open && <ExtensionsPopover project={project} listing={listing} place={open} anchor={button} onClose={close} />}
    </section>
  )
}

interface ExtensionsPopoverProps {
  project: string
  listing: Loaded
  place: CSSProperties
  /** The bar's button, which toggles the menu itself. */
  anchor: RefObject<HTMLButtonElement | null>
  /** Closes the menu; `refocus` gives the focus back to the bar. */
  onClose(refocus: boolean): void
}

/** The Extensions menu: every Extension of one scope, grouped by kind, read-only. */
function ExtensionsPopover({ project, listing, place, anchor, onClose }: ExtensionsPopoverProps): ReactNode {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [scope, setScope] = useState<ExtensionScope>('project')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose(true)
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
  }, [anchor, onClose])

  const inScope = typeof listing === 'object' ? listing.extensions.filter((extension) => extension.scope === scope) : []
  const projectName = folderName(project)

  return createPortal(
    <div ref={ref} className="cf-popover extmenu" role="dialog" aria-label={t('extensions.heading')} style={place}>
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
                    <ExtensionRow key={`${extension.plugin ?? ''}/${extension.name}`} extension={extension} />
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </div>,
    document.body
  )
}

function ExtensionRow({ extension }: { extension: Extension }): ReactNode {
  const { t } = useTranslation()
  const Icon = ICONS[extension.kind]
  const status = extension.mcp && STATUS[extension.mcp.status]
  const StatusIcon = status?.icon
  const off = extension.enabled === false || extension.mcp?.status === 'disabled'
  const sub =
    extension.enabled === false
      ? t('extensions.pluginDisabled')
      : extension.mcp?.status === 'failed'
        ? extension.mcp.detail
        : extension.mcp?.status === 'needs-sign-in'
          ? t('extensions.signInHint')
          : null
  const origin = extension.plugin ?? t(`extensions.origin.${extension.scope}`)
  return (
    <li className={`cf-row${sub ? ' cf-row--two' : ''}`} title={extension.description ?? undefined}>
      <Icon className="cf-icon" aria-hidden="true" />
      <span className="cf-row__text">
        <span className={`cf-row__title${off ? ' cf-muted' : ''}`}>{extension.name}</span>
        {sub && <span className={`cf-row__sub${failing(extension) ? ' extmenu__problem' : ''}`}>{sub}</span>}
      </span>
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
    </li>
  )
}
