import {
  CircleAlert,
  Eye,
  EyeOff,
  ExternalLink,
  Folder,
  FolderX,
  GitBranch,
  GitFork,
  History,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Puzzle,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectSessions, SessionDeletion, SessionListProblem, SessionSummary } from '../../../shared/api'
import { api, onEvent } from '../api'
import type { ElementFrame } from '../elements/interface-elements'
import type { SessionLaunch } from '../terminal/hosted-terminal'
import { ConfirmDialog } from './ConfirmDialog'
import { IconButton } from './IconButton'
import { Menu, type MenuItem } from './Menu'

interface ExplorerProps {
  /** The Session catalog; null until it first answers. */
  projects: ProjectSessions[] | null
  /** The Session shown in the centre, whose Map the Map panel follows. */
  displayedSessionId: string | null
  onDisplaySession(id: string): void
  /** Starts a Hosted session in a Project: a new Session, or one resumed or forked from a past Session. */
  onStartSession(project: string, launch: SessionLaunch): void
  onCollapse(): void
  /** What the Sessions tile takes from its Element: its title, collapsed state, colours and right-click menu. */
  frame?: ElementFrame
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

/** What the user is doing to Sessions: one's menu is open, one is being renamed, or some are being deleted. */
type Tidying =
  | {
      kind: 'menu'
      session: SessionSummary
      project: string
      at: { x: number; y: number }
      /** What its Delete acts on: the selection, when the Session is in it. */
      targets: SessionSummary[]
    }
  | { kind: 'rename'; session: SessionSummary }
  | { kind: 'delete'; sessions: SessionSummary[] }

/** The Sessions picked by clicks, as in a Windows list, and the one a Shift+click ranges from. */
interface Selection {
  ids: string[]
  anchor: string | null
}

const NO_SELECTION: Selection = { ids: [], anchor: null }

/** The keys held during a click on a row: Ctrl adds or removes one Session, Shift ranges from the last clicked. */
type Picking = Pick<MouseEvent, 'ctrlKey' | 'shiftKey'>

/** How every row reaches the user's tidying. */
interface RowActions {
  /** The id of the Session being renamed, if any. */
  renaming: string | null
  /** The id of the Session whose menu is open, if any. */
  menuOpen: string | null
  openMenu(session: SessionSummary, project: string, at: { x: number; y: number }): void
  /** Ends a rename: the new title, or null when the user backed out. */
  rename(session: SessionSummary, title: string | null): void
  /** The id of the Session shown in the centre, whose Map the Map panel follows. */
  displayed: string | null
  selected: ReadonlySet<string>
  /** A click on a row: a plain one displays the Session and picks it alone; Ctrl or Shift pick more. */
  click(session: SessionSummary, picking: Picking): void
  display(session: SessionSummary): void
  /** Starts a new Session in the Project. */
  startNew(project: string): void
}

/** The Sessions tile of the explorer: Sessions grouped by Project. */
export function Explorer({ projects, displayedSessionId, onDisplaySession, onStartSession, onCollapse, frame }: ExplorerProps): ReactNode {
  const { t } = useTranslation()
  const now = useNow()
  const [tidying, setTidying] = useState<Tidying | null>(null)
  const closeMenu = useCallback(() => setTidying((current) => (current?.kind === 'menu' ? null : current)), [])
  const [selection, setSelection] = useState(NO_SELECTION)
  const tree = useRef<HTMLUListElement>(null)
  const headingId = useId()
  const byId = new Map(projects?.flatMap((project) => project.sessions.map((session) => [session.id, session])))
  const selected = new Set(selection.ids)

  /** The ids of the rows the explorer shows, in its order, across Projects. */
  const shownIds = (): string[] =>
    [...(tree.current?.querySelectorAll<HTMLElement>('[data-session]') ?? [])].map((row) => row.dataset.session!)

  /** What an action on a row acts on: the whole selection when the row is in it, else the row alone. */
  const targetsOf = (session: SessionSummary): SessionSummary[] =>
    selected.has(session.id) && selected.size > 1
      ? shownIds().flatMap((id) => (selected.has(id) ? [byId.get(id)!] : []))
      : [session]

  const pick = ({ id }: SessionSummary, { ctrlKey, shiftKey }: Picking): void => {
    if (shiftKey) {
      const shown = shownIds()
      const anchor = selection.anchor !== null && shown.includes(selection.anchor) ? selection.anchor : id
      const ends = [shown.indexOf(anchor), shown.indexOf(id)]
      setSelection({ ids: shown.slice(Math.min(...ends), Math.max(...ends) + 1), anchor })
    } else if (ctrlKey) {
      const ids = selected.has(id) ? selection.ids.filter((other) => other !== id) : [...selection.ids, id]
      setSelection({ ids, anchor: id })
    } else {
      setSelection({ ids: [id], anchor: id })
    }
  }

  /** Asks to delete the Sessions, when any of them can be. */
  const askToDelete = (sessions: SessionSummary[]): void => {
    if (sessions.some((session) => session.state === 'past')) setTidying({ kind: 'delete', sessions })
  }

  // Escape lets go of the selection; Delete deletes it, or the focused row when outside it.
  const onTreeKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as Element
    if (target.closest('input')) return
    if (event.key === 'Escape') setSelection(NO_SELECTION)
    const row = target.closest<HTMLElement>('[data-session]')
    const session = row && byId.get(row.dataset.session!)
    if (event.key === 'Delete' && session) askToDelete(targetsOf(session))
  }

  const actions: RowActions = {
    renaming: tidying?.kind === 'rename' ? tidying.session.id : null,
    menuOpen: tidying?.kind === 'menu' ? tidying.session.id : null,
    // As in Windows, the menu of a row outside the selection picks that row alone.
    openMenu: (session, project, at) => {
      if (!selected.has(session.id)) setSelection({ ids: [session.id], anchor: session.id })
      setTidying({ kind: 'menu', session, project, at, targets: targetsOf(session) })
    },
    // The catalog pushes the new title once the backend has stored it. An emptied field is sent
    // too: it gives the Session back Claude Code's name.
    rename: (session, title) => {
      setTidying(null)
      const unchanged = title === null || title.trim() === (session.title ?? '')
      if (!unchanged) void api.sessions.rename(session.id, title)
    },
    displayed: displayedSessionId,
    selected,
    click: (session, picking) => {
      pick(session, picking)
      if (!picking.ctrlKey && !picking.shiftKey && session.state !== 'external') onDisplaySession(session.id)
    },
    display: (session) => onDisplaySession(session.id),
    startNew: (project) => onStartSession(project, { kind: 'new' })
  }

  // Only a past Session can be resumed or forked: one running elsewhere is read-only until it ends,
  // and one whose folder is gone has nowhere to run.
  const startItem = (session: SessionSummary, project: string, kind: 'resume' | 'fork', icon: LucideIcon): MenuItem => ({
    label: t(`explorer.${kind}`),
    icon,
    disabled: session.state !== 'past' || session.folderMissing,
    disabledReason:
      session.state !== 'past' ? t('explorer.openElsewhereTooltip') : t('explorer.folderMissing', { folder: session.cwd }),
    onSelect: () => onStartSession(project, { kind, sessionId: session.id })
  })

  const deleteItem = (targets: SessionSummary[]): MenuItem => {
    const many = targets.length > 1
    return {
      label: many ? t('explorer.delete.actionMany', { count: targets.length }) : t('explorer.delete.action'),
      icon: Trash2,
      danger: true,
      separated: true,
      disabled: !targets.some((target) => target.state === 'past'),
      disabledReason: t(many ? 'explorer.delete.nonePast' : 'explorer.delete.onlyPast'),
      onSelect: () => askToDelete(targets)
    }
  }

  const menuItems = (session: SessionSummary, project: string, targets: SessionSummary[]): MenuItem[] => [
    startItem(session, project, 'resume', History),
    startItem(session, project, 'fork', GitFork),
    {
      label: t('explorer.rename'),
      icon: Pencil,
      separated: true,
      onSelect: () => setTidying({ kind: 'rename', session })
    },
    session.hidden
      ? { label: t('explorer.unhide'), icon: Eye, onSelect: () => void api.sessions.setHidden(session.id, false) }
      : { label: t('explorer.hide'), icon: EyeOff, onSelect: () => void api.sessions.setHidden(session.id, true) },
    deleteItem(targets)
  ]

  return (
    <>
      <section
        className="explorer__tile"
        aria-labelledby={headingId}
        data-element={frame?.id}
        data-collapsed={frame?.collapsed}
        style={frame?.style}
        onContextMenu={frame?.onContextMenu}
        {...frame?.dropZone}
      >
        <div className="cf-panel-head" {...frame?.grip}>
          <h2 className="cf-eyebrow" id={headingId}>
            {frame?.title ?? t('explorer.heading')}
          </h2>
          <IconButton icon={PanelLeftClose} label={t('explorer.collapse')} onClick={onCollapse} />
        </div>
        <div className="explorer__tree" hidden={frame?.collapsed}>
          <ListProblem />
          {projects?.length === 0 && <p className="empty">{t('explorer.empty')}</p>}
          {projects && projects.length > 0 && (
            <ul
              ref={tree}
              className="explorer__projects"
              role="tree"
              aria-label={t('explorer.label')}
              aria-multiselectable="true"
              onKeyDown={onTreeKeyDown}
            >
              {projects.map((project) => (
                <ProjectGroup key={project.path} project={project} now={now} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      </section>
      {tidying?.kind === 'menu' && (
        <Menu label={t('explorer.sessionActions')} at={tidying.at} items={menuItems(tidying.session, tidying.project, tidying.targets)} onClose={closeMenu} />
      )}
      {tidying?.kind === 'delete' && <DeleteDialog sessions={tidying.sessions} onDone={() => setTidying(null)} />}
    </>
  )
}

/**
 * Tells the user, until they dismiss it, that ClaudeForge found its list of Session ids unreadable
 * as it started, and where that list now is: the Sessions it named are no longer listed.
 */
function ListProblem(): ReactNode {
  const { t } = useTranslation()
  const [problem, setProblem] = useState<SessionListProblem | null>(null)
  useEffect(() => {
    let active = true
    void api.sessions.listProblem().then((found) => active && setProblem(found))
    return () => {
      active = false
    }
  }, [])
  if (!problem) return null
  return (
    <div className="explorer__problem" role="alert">
      <CircleAlert className="cf-icon cf-icon--sm" aria-hidden="true" />
      <p>{t(problem.setAside ? 'explorer.listProblem.setAside' : 'explorer.listProblem.inPlace', { file: problem.file })}</p>
      <IconButton icon={X} label={t('explorer.listProblem.dismiss')} onClick={() => setProblem(null)} />
    </div>
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
    <li role="none">
      <div className="cf-project" title={project.path}>
        <Folder className="cf-icon" aria-hidden="true" />
        <h3 className="cf-project__name">{project.name}</h3>
        <IconButton
          icon={Plus}
          label={t('explorer.newSessionIn', { project: project.name })}
          onClick={() => actions.startNew(project.path)}
        />
      </div>
      <ul className="cf-sessions" role="group" aria-label={project.name}>
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} project={project.path} now={now} actions={actions} />
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
  /** The path of the Project the Session belongs to. */
  project: string
  now: number
  actions: RowActions
}

function SessionRow({ session, project, now, actions }: SessionRowProps): ReactNode {
  const { t, i18n } = useTranslation()
  const external = session.state === 'external'
  const renaming = actions.renaming === session.id
  const title = session.title ?? t('explorer.untitled')
  // A Session whose folder is gone is greyed out, and says why in its tooltip.
  const missing = !external && session.folderMissing
  // Rows never show ids: the tooltip carries the Session id under the title or the notice.
  const notice = external
    ? t('explorer.openElsewhereTooltip')
    : missing
      ? t('explorer.folderMissing', { folder: session.cwd })
      : title
  const tooltip = `${notice}\n${session.id}`
  const link = session.wayfinder
  const hasSubtitle = external || session.worktree !== null || link !== null
  const classes = [
    'cf-row',
    hasSubtitle && 'cf-row--two',
    session.hidden && 'explorer__row--hidden',
    missing && 'explorer__row--missing'
  ].filter(Boolean)
  // An External session runs elsewhere: it cannot be displayed here, only picked, so it stays out of
  // the Tab order. Clicks and keys meant for the row's own controls (its menu button, the rename
  // field) neither display nor pick it.
  return (
    <li
      className={classes.join(' ')}
      role="treeitem"
      data-session={session.id}
      title={renaming ? undefined : tooltip}
      aria-current={actions.displayed === session.id || undefined}
      aria-selected={actions.selected.has(session.id)}
      tabIndex={external ? -1 : 0}
      onClick={(event) => {
        if (!renaming && !(event.target as Element).closest('button, input')) actions.click(session, event)
      }}
      onKeyDown={(event) => {
        if (external || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        actions.display(session)
      }}
      onContextMenu={(event) => {
        if (renaming) return
        event.preventDefault()
        actions.openMenu(session, project, { x: event.clientX, y: event.clientY })
      }}
    >
      {external ? (
        <span className="cf-status cf-status--external">
          <ExternalLink className="cf-icon cf-icon--sm" aria-hidden="true" />
        </span>
      ) : missing ? (
        <span className="cf-status">
          <FolderX className="cf-icon cf-icon--sm" aria-hidden="true" />
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
            actions.openMenu(session, project, { x: left, y: bottom })
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

/**
 * Confirms moving past Sessions to the Recycle Bin, then asks the backend to. Those still running are
 * left out. Each goes on its own: the dialog stays open on the ones that failed, by title.
 */
function DeleteDialog({ sessions, onDone }: { sessions: SessionSummary[]; onDone(): void }): ReactNode {
  const { t, i18n } = useTranslation()
  const [remaining, setRemaining] = useState(() => sessions.filter((session) => session.state === 'past'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const only = sessions.length === 1 ? sessions[0] : undefined
  const skipped = sessions.length - sessions.filter((session) => session.state === 'past').length
  const titleOf = (session: SessionSummary): string => session.title ?? t('explorer.untitled')
  const titlesOf = (failures: Failure[]): string =>
    new Intl.ListFormat(i18n.language).format(
      failures.map(({ session }) => t('explorer.delete.quoted', { title: titleOf(session) }))
    )

  const describe = (failures: Failure[]): string => {
    const held = failures.filter((failure) => failure.held)
    if (only) return t(held.length > 0 ? 'explorer.delete.failed' : 'explorer.delete.onlyPast')
    const started = failures.filter((failure) => !failure.held)
    return [
      held.length > 0 && t('explorer.delete.failedMany', { count: held.length, titles: titlesOf(held) }),
      started.length > 0 && t('explorer.delete.startedMany', { count: started.length, titles: titlesOf(started) })
    ]
      .filter(Boolean)
      .join(' ')
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const deletions = await api.sessions.delete(remaining.map((session) => session.id))
      const failures = remaining.flatMap((session): Failure[] => {
        const deletion: SessionDeletion = deletions[session.id] ?? { deleted: false, reason: 'failed' }
        // A Session no longer in Claude Code's history is as good as deleted.
        if (deletion.deleted || deletion.reason === 'unknown') return []
        return [{ session, held: deletion.reason === 'failed' }]
      })
      if (failures.length === 0) return onDone()
      setRemaining(failures.map(({ session }) => session))
      setError(describe(failures))
    } catch {
      setError(t('explorer.delete.failed'))
    }
    setBusy(false)
  }

  return (
    <ConfirmDialog
      title={only ? t('explorer.delete.title') : t('explorer.delete.titleMany', { count: remaining.length })}
      actionLabel={t('explorer.delete.action')}
      actionIcon={Trash2}
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={onDone}
    >
      {only ? (
        <>
          <p>{t('explorer.delete.body', { title: titleOf(only) })}</p>
          <code className="cf-mono cf-muted">{only.id}.jsonl</code>
        </>
      ) : (
        <>
          <p>{t('explorer.delete.bodyMany', { count: remaining.length })}</p>
          <ul className="confirm-dialog__sessions">
            {remaining.map((session) => (
              <li key={session.id}>{titleOf(session)}</li>
            ))}
          </ul>
          {skipped > 0 && <p className="cf-muted">{t('explorer.delete.skipped', { count: skipped })}</p>}
        </>
      )}
    </ConfirmDialog>
  )
}

/** A Session of a batch that is still here: its files were held open (`held`), or it started running since. */
interface Failure {
  session: SessionSummary
  held: boolean
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
  /** The Shortcuts, under the expand button. */
  children?: ReactNode
}

export function ExplorerRail({ onExpand, children }: ExplorerRailProps): ReactNode {
  const { t } = useTranslation()
  return (
    <>
      <IconButton icon={PanelLeftOpen} label={t('explorer.expand')} onClick={onExpand} />
      {children}
      <div className="rail__end">
        <IconButton icon={Puzzle} label={t('extensions.heading')} onClick={onExpand} />
      </div>
    </>
  )
}
