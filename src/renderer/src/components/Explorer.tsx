import { ExternalLink, Folder, GitBranch, PanelLeftClose, PanelLeftOpen, Puzzle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectSessions, SessionSummary } from '../../../shared/api'
import { api, onEvent } from '../api'
import { IconButton } from './IconButton'

interface ExplorerProps {
  onCollapse(): void
}

/** The Session catalog as the backend last pushed it; null until it first answers. */
function useSessionCatalog(): ProjectSessions[] | null {
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

/** The explorer column: Sessions grouped by Project, with the Extensions bar docked under it. */
export function Explorer({ onCollapse }: ExplorerProps): ReactNode {
  const { t } = useTranslation()
  const projects = useSessionCatalog()
  const now = useNow()
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
              <ProjectGroup key={project.path} project={project} now={now} />
            ))}
          </ul>
        )}
      </div>
      <ExtensionsBar />
    </>
  )
}

function ProjectGroup({ project, now }: { project: ProjectSessions; now: number }): ReactNode {
  return (
    <li>
      <h3 className="cf-project" title={project.path}>
        <Folder className="cf-icon" aria-hidden="true" />
        <span className="cf-project__name">{project.name}</span>
      </h3>
      <ul className="cf-sessions" aria-label={project.name}>
        {project.sessions.map((session) => (
          <SessionRow key={session.id} session={session} now={now} />
        ))}
      </ul>
    </li>
  )
}

function SessionRow({ session, now }: { session: SessionSummary; now: number }): ReactNode {
  const { t, i18n } = useTranslation()
  const external = session.state === 'external'
  const title = session.title ?? t('explorer.untitled')
  // Rows never show ids: the tooltip carries the Session id under the title or the External notice.
  const tooltip = `${external ? t('explorer.openElsewhereTooltip') : title}\n${session.id}`
  const hasSubtitle = external || session.worktree !== null
  return (
    <li
      className={hasSubtitle ? 'cf-row cf-row--two' : 'cf-row'}
      title={tooltip}
      aria-disabled={external || undefined}
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
        <span className="cf-row__title cf-muted">{title}</span>
        {hasSubtitle && (
          <span className="cf-row__sub">
            {external && <span>{t('explorer.openElsewhere')}</span>}
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
    </li>
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

export function ExtensionsBar(): ReactNode {
  const { t } = useTranslation()
  return (
    <section className="extbar" aria-label={t('extensions.heading')}>
      <span className="cf-eyebrow">{t('extensions.heading')}</span>
    </section>
  )
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
