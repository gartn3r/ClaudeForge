import {
  Bug,
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ClipboardCheck,
  FileText,
  LoaderCircle,
  RefreshCw,
  Settings,
  Star,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { BacklogConfig, BacklogFailure, BacklogProblem, Sprint, WorkItem, WorkItemAction, WorkItemListing } from '../../../shared/api'
import {
  ACTION_COLOURS,
  LIME,
  actionColour,
  backlogConfigured,
  textOn,
  workItemKind,
  workItemStarted,
  type WorkItemKind
} from '../../../shared/work-items'
import { api } from '../api'
import type { ElementFrame } from '../elements/interface-elements'
import { folderName } from './ExtensionsMenu'

/** The glyph each kind of Work item shows with (Lucide, as the design system's icons). */
const GLYPHS: Record<WorkItemKind['glyph'], LucideIcon> = {
  pbi: FileText,
  bug: Bug,
  task: ClipboardCheck,
  feature: Star,
  other: CircleDot
}

/** The command that puts right what keeps `az` from reading the backlog, which the user can type into a terminal. */
export const FIX_COMMANDS: Partial<Record<BacklogProblem, string>> = {
  // Claude Code's shell mode cannot answer winget's agreement prompts.
  'az-missing': 'winget install -e --id Microsoft.AzureCLI --accept-source-agreements --accept-package-agreements',
  'extension-missing': 'az extension add --name azure-devops',
  'signed-out': 'az login'
}

/** The Work items card's backlog: read when the displayed Project or the configuration changes, and when the user asks. */
export interface WorkItemsReading {
  /** The last listing read; it stays while the next is read. Null before the first, or without a configuration. */
  listing: WorkItemListing | null
  /** A read is under way. */
  reading: boolean
  refresh(): void
}

/**
 * Reads the Current sprint's Work items once a Project is displayed, again for another Project or
 * configuration, and when the user refreshes; never on a timer (ADR 0008).
 */
export function useWorkItems(config: BacklogConfig | null, project: string): WorkItemsReading {
  const [revision, setRevision] = useState(0)
  /** The last listing read, for the configuration it was read with, and the read that brought it. */
  const [read, setRead] = useState<{ key: string; request: string; value: WorkItemListing } | null>(null)
  const key = backlogConfigured(config) ? JSON.stringify(config) : null
  const request = key && JSON.stringify([key, project, revision])

  useEffect(() => {
    if (!key || !request) return
    let current = true
    void api.backlog
      .workItems(JSON.parse(key) as BacklogConfig)
      .catch(backlogFailure)
      .then((value) => current && setRead({ key, request, value }))
    return () => {
      current = false
    }
  }, [key, request])

  const refresh = useCallback(() => setRevision((each) => each + 1), [])
  // A listing read for another configuration is not shown; one for this configuration stays while the next is read.
  return { listing: key && read?.key === key ? read.value : null, reading: !!request && read?.request !== request, refresh }
}

/** A call to the backend that failed outright, as the failure of `az` the card shows. */
export const backlogFailure = (error: unknown): BacklogFailure => ({
  ok: false,
  problem: 'az-failed',
  detail: error instanceof Error ? error.message : String(error)
})

/** A `YYYY-MM-DD` day as the card writes it: `13/11`. */
export const shortDay = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`

interface WorkItemsCardProps {
  config: BacklogConfig | null
  actions: WorkItemAction[]
  reading: WorkItemsReading
  /** The displayed Project, which each action's command goes to. */
  project: string
  /** The displayed Project's skills, by the name Claude Code types them with; null while unknown. */
  skills: ReadonlySet<string> | null
  onConfigure(): void
  onAction(action: WorkItemAction, workItem: WorkItem): void
  onOpen(workItem: WorkItem): void
  /** Types a command that puts `az` right into a terminal, never sent. */
  onTypeFix(command: string): void
  frame?: ElementFrame
}

/**
 * The Work items card, above the Sessions: the Current sprint's Work items that are the user's or
 * unassigned, in two groups, each with its Work item actions; the same for every Project. Each
 * state that keeps it from listing them says what to do.
 */
export function WorkItemsCard(props: WorkItemsCardProps): ReactNode {
  const { config, reading, onConfigure, frame } = props
  const { t } = useTranslation()
  const headingId = useId()
  const configured = backlogConfigured(config)
  const { listing } = reading

  return (
    <section
      className="work-items cf-tile cf-tile--card"
      aria-labelledby={headingId}
      aria-busy={reading.reading}
      data-element={frame?.id}
      style={frame?.style}
      onContextMenu={frame?.onContextMenu}
      {...frame?.dropZone}
    >
      <div className="work-items__head" {...frame?.grip}>
        <h2 className="cf-heading" id={headingId}>
          {frame?.title ?? t('workItems.heading')}
        </h2>
        {configured && (
          <>
            <button
              type="button"
              className="cf-btn cf-btn--icon work-items__round"
              aria-label={reading.reading ? t('workItems.refreshing') : t('workItems.refresh')}
              title={reading.reading ? t('workItems.refreshing') : t('workItems.refresh')}
              data-reading={reading.reading}
              disabled={reading.reading}
              onClick={reading.refresh}
            >
              {reading.reading ? (
                <LoaderCircle className="cf-icon work-items__spinner" aria-hidden="true" />
              ) : (
                <RefreshCw className="cf-icon" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="cf-btn cf-btn--icon work-items__round"
              aria-label={t('workItems.configure')}
              title={t('workItems.configure')}
              onClick={onConfigure}
            >
              <Settings className="cf-icon" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {!frame?.collapsed &&
        (!configured ? (
          <div className="work-items__state">
            <p className="work-items__lead">{t('workItems.notConfigured')}</p>
            <button type="button" className="cf-btn cf-btn--primary work-items__connect" onClick={onConfigure}>
              {t('workItems.connect')}
            </button>
          </div>
        ) : !listing ? (
          <ReadingPlaceholder />
        ) : !listing.ok ? (
          <ProblemState problem={listing.problem} detail={listing.detail} onTypeFix={props.onTypeFix} />
        ) : !listing.sprint ? (
          <div className="work-items__state">
            <p className="work-items__note">
              <Calendar className="cf-icon" aria-hidden="true" />
              <span>
                <Trans
                  i18nKey="workItems.noSprint"
                  values={{ root: config!.iterationRoot.split('\\').at(-1) }}
                  components={{ m: <span className="cf-mono" /> }}
                />
              </span>
            </p>
            <button type="button" className="cf-btn" onClick={onConfigure}>
              {t('workItems.configureButton')}
            </button>
          </div>
        ) : (
          <SprintList {...props} sprint={listing.sprint} upcoming={listing.upcoming} workItems={listing.workItems} />
        ))}
    </section>
  )
}

/** While the first listing is read: grey bars where the Work items will be. */
function ReadingPlaceholder(): ReactNode {
  const { t } = useTranslation()
  return (
    <div className="work-items__state">
      <span className="work-items__sprint">{t('workItems.refreshing')}</span>
      <div className="work-items__skeleton" aria-hidden="true">
        <span style={{ width: '40%' }} />
        <span style={{ width: '95%' }} />
        <span style={{ width: '70%' }} />
      </div>
    </div>
  )
}

interface ProblemStateProps {
  problem: BacklogProblem
  detail: string
  onTypeFix(command: string): void
}

/** Why `az` cannot read the backlog, and the command that puts it right, to type into a terminal. */
function ProblemState({ problem, detail, onTypeFix }: ProblemStateProps): ReactNode {
  const { t } = useTranslation()
  const command = FIX_COMMANDS[problem]
  return (
    <div className="work-items__state" role="alert">
      <p className="work-items__problem">
        <CircleAlert className="cf-icon" aria-hidden="true" />
        <span>
          <strong>{t(`workItems.problem.${problem}`)}</strong> {command ? t('workItems.problem.runThis') : detail}
        </span>
      </p>
      {command && (
        <>
          <code className="work-items__command cf-mono">{command}</code>
          <button type="button" className="cf-btn" onClick={() => onTypeFix(command)}>
            {t('workItems.problem.typeIt')}
          </button>
        </>
      )}
    </div>
  )
}

interface SprintListProps extends WorkItemsCardProps {
  sprint: Sprint
  upcoming: boolean
  workItems: WorkItem[]
}

/** The Current sprint, then its Work items: the user's, then the unassigned, each group folding away. */
function SprintList({ sprint, upcoming, workItems, ...props }: SprintListProps): ReactNode {
  const { t, i18n } = useTranslation()
  const mine = workItems.filter((workItem) => workItem.assignedToMe)
  const unassigned = workItems.filter((workItem) => !workItem.assignedToMe)
  // The unassigned can be many: while the user has Work items of their own, they are folded until the user opens them.
  const [toggled, setToggled] = useState<{ mine?: boolean; unassigned?: boolean }>({})
  const open = { mine: toggled.mine ?? true, unassigned: toggled.unassigned ?? mine.length === 0 }
  const [year, month, date] = sprint.start.split('-').map(Number) as [number, number, number]
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }).format(new Date(year, month - 1, date))

  return (
    <>
      <div className="work-items__sprint">
        <Calendar className="cf-icon" aria-hidden="true" />
        {upcoming ? (
          <>
            <span>{sprint.name}</span>
            <span className="work-items__upcoming">
              {t('workItems.startsOn', { day: `${weekday} ${shortDay(sprint.start)}` })}
            </span>
          </>
        ) : (
          <span>{t('workItems.sprint', { name: sprint.name, finish: shortDay(sprint.finish) })}</span>
        )}
      </div>
      {workItems.length === 0 ? (
        <p className="work-items__note">
          <CircleCheck className="cf-icon" aria-hidden="true" />
          <span>{t('workItems.empty')}</span>
        </p>
      ) : (
        <div className="work-items__groups">
          {(['mine', 'unassigned'] as const).map((group) => {
            const list = group === 'mine' ? mine : unassigned
            if (!list.length) return null
            return (
              <WorkItemGroup
                key={group}
                label={t(`workItems.${group}`, { count: list.length })}
                open={open[group]}
                onToggle={() => setToggled((each) => ({ ...each, [group]: !open[group] }))}
              >
                {list.map((workItem) => (
                  <WorkItemBox key={workItem.id} workItem={workItem} {...props} />
                ))}
              </WorkItemGroup>
            )
          })}
          {props.actions.length === 0 && <p className="work-items__hint">{t('workItems.noActions')}</p>}
        </div>
      )}
    </>
  )
}

interface WorkItemGroupProps {
  label: string
  open: boolean
  onToggle(): void
  children: ReactNode
}

function WorkItemGroup({ label, open, onToggle, children }: WorkItemGroupProps): ReactNode {
  const listId = useId()
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="work-items__group">
      <button type="button" className="work-items__group-head cf-eyebrow" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
        <Chevron className="cf-icon" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <ul className="work-items__list" id={listId} aria-label={label}>
          {children}
        </ul>
      )}
    </div>
  )
}

interface WorkItemBoxProps extends WorkItemsCardProps {
  workItem: WorkItem
}

/** One Work item in its box: its type, number and state, its title (opened in a Web tab), then its actions. */
function WorkItemBox({ workItem, actions, project, skills, onAction, onOpen }: WorkItemBoxProps): ReactNode {
  const { t } = useTranslation()
  const kind = workItemKind(workItem.type)
  const Glyph = GLYPHS[kind.glyph]
  return (
    <li className="work-item" data-work-item={workItem.id}>
      <div className="work-item__meta">
        <Glyph className="cf-icon work-item__glyph" role="img" aria-label={workItem.type} />
        {kind.label && <span className="work-item__type">{kind.label}</span>}
        <span className="work-item__id cf-mono">#{workItem.id}</span>
        <span className="work-item__state">
          <span className={`work-item__dot${workItemStarted(workItem.state) ? '' : ' work-item__dot--todo'}`} aria-hidden="true" />
          {workItem.state}
        </span>
      </div>
      <button type="button" className="work-item__title" title={t('workItems.open')} onClick={() => onOpen(workItem)}>
        {workItem.title}
      </button>
      {actions.length > 0 && (
        <div className="work-item__actions">
          {actions.map((action, index) => {
            const missing = skills !== null && !skills.has(action.skill)
            return (
              <button
                key={action.id}
                type="button"
                className="work-item__action"
                style={actionStyle(action, index)}
                aria-disabled={missing || undefined}
                title={missing ? t('shortcuts.missingSkill', { project: folderName(project) }) : undefined}
                onClick={() => !missing && onAction(action, workItem)}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      )}
    </li>
  )
}

/** How an action's button is coloured: lime for the first, else its colour or an outline, its label readable on it. */
export function actionStyle(action: WorkItemAction, index: number): CSSProperties {
  const colour = actionColour(action, index)
  if (colour === 'outline') return {}
  // Lime and Slate are the Theme's own, so they turn over with it; any other stays as the user chose it.
  if (colour === LIME) return { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--on-accent)' }
  if (colour === ACTION_COLOURS.slate) {
    return { background: 'var(--action-slate)', borderColor: 'var(--action-slate)', color: 'var(--action-slate-text)' }
  }
  return { background: colour, borderColor: colour, color: textOn(colour) }
}
