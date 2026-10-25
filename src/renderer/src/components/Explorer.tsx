import {
  Eye,
  EyeOff,
  ExternalLink,
  Folder,
  GitBranch,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Puzzle,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectSessions, SessionSummary } from '../../../shared/api'
import { api, onEvent } from '../api'
import type { HostedTab } from '../terminal/hosted-sessions'
import { ConfirmDialog } from './ConfirmDialog'
import { ExtensionsBar } from './ExtensionsMenu'
import { IconButton } from './IconButton'
import { Menu, type MenuItem } from './Menu'

interface ExplorerProps {
  /** The Session catalog; null until it first answers. */
  projects: ProjectSessions[] | null
  /** The Session shown in the centre, whose Map the Map panel follows. */
  displayedSessionId: string | null
  onDisplaySession(id: string): void
  /** The displayed Project, whose Extensions the Extensions bar counts. */
  project: string
  /** The Hosted sessions' tabs, which the Extensions menu names after a change. */
  hostedTabs: HostedTab[]
  onShowHostedSession(key: string): void
  onCollapse(): void
}

/** The Session catalog as the backend last pushed it; null until it first answers. */
export function useSessionCatalog(): ProjectSessions[] | null {
  const [projects, setProjects] = useState<ProjectSessions[] | null>(null)
  useEffect(() => {
    let active = true
    const unsubscribe = onEvent('sessions.changed', setProjects)
    void api.sessions.list().then((listed) => active && setProjects(listed))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return projects
}

const MINUTE = 60_000

/** The current time, updated every minute so relative times stay true. */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** What the user is doing to one Session: its menu is open, or it is being renamed or deleted. */
type Tidying =
  | { kind: 'menu'; session: SessionSummary; at: { x: number; y: number } }
  | { kind: 'rename'; session: SessionSummary }
  | { kind: 'delete'; session: SessionSummary }

/** How every row reaches the user's tidying. */
interface RowActions {
  /** The id of the Session being renamed, if any. */
  renaming: string | null
  /** The id of the Session whose menu is open, if any. */
  menuOpen: string | null
  openMenu(session: SessionSummary, at: { x: number; y: number }): void
  /** Ends a rename: the new title, or null when the user backed out. */
  rename(session: SessionSummary, title: string | null): void
  /** The id of the Session shown in the centre, whose Map the Map panel follows. */
  displayed: string | null
  display(session: SessionSummary): void
}

/** The explorer column: Sessions grouped by Project, with the Extensions bar docked under it. */
export function Explorer({
  projects,
  displayedSessionId,
  onDisplaySession,
  project,
  hostedTabs,
  onShowHostedSession,
  onCollapse
}: ExplorerProps): ReactNode {
  const { t } = useTranslation()
  const now = useNow()
  const [tidying, setTidying] = useState<Tidying | null>(null)
  const closeMenu = useCallback(() => setTidying((current) => (current?.kind === 'menu' ? null : current)), [])

  const actions: RowActions = {
    renaming: tidying?.kind === 'rename' ? tidying.session.id : null,
    menuOpen: tidying?.kind === 'menu' ? tidying.session.id : null,
    openMenu: (session, at) => setTidying({ kind: 'menu', session, at }),
    // The catalog pushes the new title once the backend has stored it. An emptied field is sent
    // too: it gives the Session back Claude Code's name.
    rename: (session, title) => {
      setTidying(null)
      const unchanged = title === null || title.trim() === (session.title ?? '')
      if (!unchanged) void api.sessions.rename(session.id, title)
    },
    displayed: displayedSessionId,
    display: (session) => onDisplaySession(session.id)
  }

  const menuItems = (session: SessionSummary): MenuItem[] => [
    { label: t('explorer.rename'), icon: Pencil, onSelect: () => setTidying({ kind: 'rename', session }) },
    session.hidden
      ? { label: t('explorer.unhide'), icon: Eye, onSelect: () => void api.sessions.setHidden(session.id, false) }
      : { label: t('explorer.hide'), icon: EyeOff, onSelect: () => void api.sessions.setHidden(session.id, true) },
    {
      label: t('explorer.delete.action'),
      icon: Trash2,
      danger: true,
      separated: true,
      disabled: session.state !== 'past',
      disabledReason: t('explorer.delete.onlyPast'),
      onSelect: () => setTidying({ kind: 'delete', session })
    }
  ]

  return (
    <>
      <div className="cf-panel-head">
        <span className="cf-eyebrow">{t('explorer.heading')}</span>
        <IconButton icon={PanelLeftClose} label={t('explorer.collapse')} onClick={onCollapse} />
      </div>
      <div className="explorer__tree">
        {projects?.length === 0 && <p className="empty">{t('explorer.empty')}</p>}
        {projects && projects.length > 0 && (
          <ul className="explorer__projects">
            {projects.map((project) => (
              <ProjectGroup key={project.path} project={project} now={now} actions={actions} />
            ))}
          </ul>
        )}
      </div>
      <ExtensionsBar project={project} hostedTabs={hostedTabs} onShowHostedSession={onShowHostedSession} />
      {tidying?.kind === 'menu' && (
        <Menu label={t('explorer.sessionActions')} at={tidying.at} items={menuItems(tidying.session)} onClose={closeMenu} />
      )}
      {tidying?.kind === 'delete' && <DeleteDialog session={tidying.session} onDone={() => setTidying(null)} />}
    </>
  )
}

interface ProjectGroupProps {
  project: ProjectSessions
  now: number
  actions: RowActions
}

function ProjectGroup({ project, now, actions }: ProjectGroupProps): ReactNode {
  const { t } = useTranslation()
  const [showHidden, setShowHidden] = useState(false)
  const hiddenCount = project.sessions.filter((session) => session.hidden).length
  // Once nothing is hidden the switch goes, so a Session hidden later leaves the list at once.
  if (showHidden && hiddenCount === 0) setShowHidden(false)
  const sessions = showHidden ? project.sessions : project.sessions.filter((session) => !session.hidden)
  return (
    <li>
      <h3 className="cf-project" title={project.path}>
        <Folder className="cf-icon" aria-hidden="true" />
        <span className="cf-project__name">{project.name}</span>
      </h3>
      <ul className="cf-sessions" aria-label={project.name}>
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} now={now} actions={actions} />
        ))}
      </ul>
      {hiddenCount > 0 && (
        <label className="explorer__show-hidden">
          <button
            type="button"
            role="switch"
            aria-checked={showHidden}
            aria-label={t('explorer.showHiddenIn', { project: project.name })}
            className="cf-toggle"
            onClick={() => setShowHidden(!showHidden)}
          />
          <span aria-hidden="true">{t('explorer.showHidden')}</span>
          <span className="cf-row__meta" aria-hidden="true">
            {hiddenCount}
          </span>
        </label>
      )}
    </li>
  )
}

interface SessionRowProps {
  session: SessionSummary
  now: number
  actions: RowActions
}

function SessionRow({ session, now, actions }: SessionRowProps): ReactNode {
  const { t, i18n } = useTranslation()
  const external = session.state === 'external'
  const renaming = actions.renaming === session.id
  const title = session.title ?? t('explorer.untitled')
  // Rows never show ids: the tooltip carries the Session id under the title or the External notice.
  const tooltip = `${external ? t('explorer.openElsewhereTooltip') : title}\n${session.id}`
  const link = session.wayfinder
  const hasSubtitle = external || session.worktree !== null || link !== null
  const classes = ['cf-row', hasSubtitle && 'cf-row--two', session.hidden && 'explorer__row--hidden'].filter(Boolean)
  // An External session runs elsewhere: it cannot be displayed here. Clicks and keys meant
  // for the row's own controls (its menu button, the rename field) do not display it either.
  const displayHandlers = external
    ? {}
    : {
        tabIndex: 0,
        onClick: (event: MouseEvent) => {
          if (!renaming && !(event.target as Element).closest('button, input')) actions.display(session)
        },
        onKeyDown: (event: KeyboardEvent) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          actions.display(session)
        }
      }
  return (
    <li
      className={classes.join(' ')}
      title={renaming ? undefined : tooltip}
      aria-disabled={external || undefined}
      aria-current={actions.displayed === session.id || undefined}
      {...displayHandlers}
      onContextMenu={(event) => {
        if (renaming) return
        event.preventDefault()
        actions.openMenu(session, { x: event.clientX, y: event.clientY })
      }}
    >
      {external ? (
        <span className="cf-status cf-status--external">
          <ExternalLink className="cf-icon cf-icon--sm" aria-hidden="true" />
        </span>
      ) : (
        <span className="cf-status">
          <span className="cf-dot cf-dot--none" />
        </span>
      )}
      <span className="cf-row__text">
        {renaming ? (
          <RenameField session={session} onDone={(name) => actions.rename(session, name)} />
        ) : (
          <span className="cf-row__title cf-muted">{title}</span>
        )}
        {hasSubtitle && (
          <span className="cf-row__sub">
            {external && <span>{t('explorer.openElsewhere')}</span>}
            {link && (
              <span className="explorer__wayfinder">
                {link.ticket
                  ? t('explorer.subtitle.ticket', { name: link.ticket.name })
                  : t('explorer.subtitle.map', { name: link.mapName })}
              </span>
            )}
            {session.worktree && (
              <span className="cf-chip">
                <GitBranch className="cf-icon cf-icon--sm" aria-hidden="true" />
                {session.worktree}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="cf-row__meta">{formatActivity(session.lastActivity, now, i18n.language, t)}</span>
      {!renaming && (
        <button
          type="button"
          className="cf-btn cf-btn--ghost cf-btn--icon explorer__row-actions"
          aria-label={t('explorer.sessionActions')}
          aria-haspopup="menu"
          aria-expanded={actions.menuOpen === session.id}
          title={t('explorer.sessionActions')}
          onClick={(event) => {
            const { left, bottom } = event.currentTarget.getBoundingClientRect()
            actions.openMenu(session, { x: left, y: bottom })
          }}
        >
          <MoreHorizontal className="cf-icon" aria-hidden="true" />
        </button>
      )}
    </li>
  )
}

/** The Session's title as a field: Enter or leaving it keeps the new name, Escape the old one. */
function RenameField({ session, onDone }: { session: SessionSummary; onDone(title: string | null): void }): ReactNode {
  const { t } = useTranslation()
  const done = useRef(false)
  const finish = (title: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(title)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') finish(event.currentTarget.value)
    else if (event.key === 'Escape') finish(null)
  }
  return (
    <input
      className="explorer__rename"
      aria-label={t('explorer.sessionName')}
      defaultValue={session.title ?? ''}
      placeholder={t('explorer.untitled')}
      maxLength={200}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  )
}

/** Confirms moving a past Session to the Recycle Bin, then asks the backend to. */
function DeleteDialog({ session, onDone }: { session: SessionSummary; onDone(): void }): ReactNode {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const deletion = await api.sessions.delete(session.id)
      if (deletion.deleted) return onDone()
      setError(t(deletion.reason === 'unknown' ? 'explorer.delete.gone' : 'explorer.delete.onlyPast'))
    } catch {
      setError(t('explorer.delete.failed'))
    }
    setBusy(false)
  }
  return (
    <ConfirmDialog
      title={t('explorer.delete.title')}
      actionLabel={t('explorer.delete.action')}
      actionIcon={Trash2}
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={onDone}
    >
      <p>{t('explorer.delete.body', { title: session.title ?? t('explorer.untitled') })}</p>
      <code className="cf-mono cf-muted">{session.id}.jsonl</code>
    </ConfirmDialog>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']

/** Last activity as the explorer shows it: "now", "5 min", "3 h", "Tue", "Oct 22", "Oct 22, 2025". */
function formatActivity(time: number, now: number, language: string, t: Translate): string {
  const minutes = Math.floor((now - time) / MINUTE)
  if (minutes < 1) return t('explorer.activity.now')
  if (minutes < 60) return t('explorer.activity.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('explorer.activity.hours', { n: hours })
  const date = new Date(time)
  if (hours < 24 * 6) return date.toLocaleDateString(language, { weekday: 'short' })
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(language, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

interface ExplorerRailProps {
  onExpand(): void
}

export function ExplorerRail({ onExpand }: ExplorerRailProps): ReactNode {
  const { t } = useTranslation()
  return (
    <>
      <IconButton icon={PanelLeftOpen} label={t('explorer.expand')} onClick={onExpand} />
      <div className="rail__end">
        <IconButton icon={Puzzle} label={t('extensions.heading')} onClick={onExpand} />
      </div>
    </>
  )
}
