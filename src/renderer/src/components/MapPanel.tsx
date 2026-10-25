import { Check, ChevronDown, ChevronLeft, ChevronRight, Map as MapIcon, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type {
  MapListing,
  MapPreferences,
  MapSummary,
  MapView,
  SessionSummary,
  Ticket,
  TrackerProblem,
  WayfinderMap
} from '../../../shared/api'
import { api } from '../api'
import { IconButton } from './IconButton'
import { MapGraph, Rollup, openBlockerNames } from './MapGraph'
import { MapText, itemCount } from './MapText'
import { MapTree } from './MapTree'

/** The Map the panel shows when no Session names one: the most recently updated open one. */
export const shownMap = (listing: MapListing): MapSummary | undefined => listing.maps.find((map) => map.open)

const PROBLEM_MESSAGES = {
  'gh-missing': 'map.problem.ghMissing',
  'gh-signed-out': 'map.problem.ghSignedOut',
  'no-github-repository': 'map.problem.noGitHubRepository',
  'gh-failed': 'map.problem.ghFailed'
} as const satisfies Record<TrackerProblem, string>

/** A change to how one Map is shown, as the user makes it. */
type PreferenceChange = { view?: MapView; hideClosed?: boolean; folded?: string[] }

/** A Map's preferences with a change applied, the defaults left out as app state keeps them. */
function changePreferences(base: MapPreferences, change: PreferenceChange): MapPreferences {
  const next: MapPreferences = { ...base }
  if (change.view === 'tree') next.view = 'tree'
  else if (change.view === 'graph') delete next.view
  if (change.hideClosed === true) next.hideClosed = true
  else if (change.hideClosed === false) delete next.hideClosed
  if (change.folded?.length) next.folded = change.folded
  else if (change.folded) delete next.folded
  return next
}

/** A load of one Map of one Project, and how it went. */
type Loaded = { project: string; mapId: string } & ({ map: WayfinderMap } | { error: true })

interface MapPanelProps {
  project: string
  /** The Project's Tracker and Maps; null while they load. */
  listing: MapListing | null
  /** The Project's Sessions, whose Tickets carry their badges. */
  sessions: SessionSummary[]
  /** The Session shown in the centre, whose Map the panel follows; null when none is. */
  displayedSession: SessionSummary | null
  /** How the user last looked at each of the Project's Maps, by Map id. */
  preferences: Record<string, MapPreferences>
  onDisplaySession(id: string): void
  onCollapse(): void
}

/**
 * The Map panel: the Map the displayed Session works on, else its Project's most recent open
 * Map, unless the user chose another of the Project's Maps since that Session was displayed.
 */
export function MapPanel({
  project,
  listing,
  sessions,
  displayedSession,
  preferences,
  onDisplaySession,
  onCollapse
}: MapPanelProps): ReactNode {
  const { t } = useTranslation()
  // A Map the user chose holds until the displayed Session or Project changes.
  const followKey = `${project}\n${displayedSession?.id ?? ''}`
  const [chosen, setChosen] = useState<{ followKey: string; mapId: string } | null>(null)
  const chosenId = chosen?.followKey === followKey ? chosen.mapId : undefined
  const linkedId = displayedSession?.wayfinder?.mapId
  const summary =
    listing &&
    (listing.maps.find((map) => map.id === chosenId) ??
      listing.maps.find((map) => map.id === linkedId) ??
      shownMap(listing))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // The Parent Ticket the user opened holds while the panel shows the same Map of the same Project.
  const [opened, setOpened] = useState<{ mapKey: string; ticketId: string } | null>(null)

  // A new listing reloads the Map only when it names another one or a newer version.
  const mapId = summary?.id
  const updatedAt = summary?.updatedAt
  useEffect(() => {
    if (!mapId) return
    let current = true
    api.map.load(project, mapId).then(
      (map) => current && setLoaded({ project, mapId, map }),
      () => current && setLoaded({ project, mapId, error: true })
    )
    return () => {
      current = false
    }
  }, [project, mapId, updatedAt])

  // Only the load of the Map shown now counts, never a previous Project's or Map's.
  const result = loaded?.project === project && loaded.mapId === mapId ? loaded : null
  const map = result && 'map' in result ? result.map : null
  const mapKey = `${project}
${mapId ?? ''}`
  // Once its Sub-tickets are gone, an opened Ticket gives way to the Map's own level.
  const level =
    (opened?.mapKey === mapKey && map?.tickets.find((ticket) => ticket.id === opened.ticketId && ticket.rollup)) || null
  const openLevel = (ticketId: string | null): void => setOpened(ticketId === null ? null : { mapKey, ticketId })

  // The user's latest change shows at once; app state keeps it for the next time the Map is shown.
  const [changed, setChanged] = useState<{ mapKey: string; preferences: MapPreferences } | null>(null)
  const shown = changed?.mapKey === mapKey ? changed.preferences : ((mapId ? preferences[mapId] : undefined) ?? {})
  const changeShown = (change: PreferenceChange): void => {
    if (!mapId) return
    setChanged({ mapKey, preferences: changePreferences(shown, change) })
    void api.appState.write({ maps: { [project]: { [mapId]: change } } })
  }
  const view: MapView = shown.view ?? 'graph'
  const folded = shown.folded ?? []
  const fold = (ticketId: string, fold: boolean): void =>
    changeShown({ folded: fold ? [...folded, ticketId] : folded.filter((id) => id !== ticketId) })
  const openInGraph = (ticketId: string): void => {
    openLevel(ticketId)
    changeShown({ view: 'graph' })
  }

  let body: ReactNode = null
  if (listing?.tracker.kind === 'unsupported') {
    const { name } = listing.tracker
    body = <p className="empty">{name ? t('map.unsupportedNamed', { name }) : t('map.unsupported')}</p>
  } else if (listing?.problem) {
    body = (
      <p className="empty">
        <Trans i18nKey={PROBLEM_MESSAGES[listing.problem]} components={{ code: <code className="cf-mono" /> }} />
      </p>
    )
  } else if (listing && !summary) body = <p className="empty">{t('map.noMap')}</p>
  else if (result && 'error' in result) {
    body = <p className="empty">{t(listing?.tracker.kind === 'github' ? 'map.loadErrorGitHub' : 'map.loadError')}</p>
  } else if (map) {
    body = (
      <MapView
        map={map}
        level={view === 'graph' ? level : null}
        onOpen={openLevel}
        tree={
          view === 'tree' && (
            <MapTree
              map={map}
              hideClosed={!!shown.hideClosed}
              onHideClosed={(hideClosed) => changeShown({ hideClosed })}
              folded={folded}
              onFold={fold}
              onOpen={openInGraph}
            />
          )
        }
        sessions={sessions}
        displayedSessionId={displayedSession?.id ?? null}
        onDisplaySession={onDisplaySession}
      />
    )
  }

  return (
    <>
      <div className="cf-panel-head">
        <span className="cf-eyebrow">{t('map.heading')}</span>
        {map && view === 'graph' && level && <LevelCrumbs map={map} level={level} onOpen={openLevel} />}
        {map && listing && (view === 'tree' || !level) && (
          <h2 className="map-name">
            <MapSelector
              maps={listing.maps}
              shown={map}
              onChoose={(mapId) => setChosen({ followKey, mapId })}
            />
          </h2>
        )}
        {map && (
          <div className="cf-seg" role="group" aria-label={t('map.view')}>
            {(['graph', 'tree'] as const).map((each) => (
              <button key={each} type="button" aria-pressed={view === each} onClick={() => changeShown({ view: each })}>
                {t(`map.views.${each}`)}
              </button>
            ))}
          </div>
        )}
        <IconButton icon={PanelRightClose} label={t('map.collapse')} onClick={onCollapse} />
      </div>
      <div className="map-panel__body">{body}</div>
    </>
  )
}

interface MapSelectorProps {
  maps: MapSummary[]
  shown: MapSummary
  onChoose(mapId: string): void
}

/** The shown Map's name, opening a menu of the Project's Maps. */
function MapSelector({ maps, shown, onChoose }: MapSelectorProps): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="map-selector" ref={ref}>
      <button
        type="button"
        className="cf-btn cf-btn--ghost map-selector__button"
        title={`${shown.name}\n${t('map.chooseMap')}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MapIcon className="cf-icon cf-icon--sm" aria-hidden="true" />
        <span>{shown.name}</span>
        <ChevronDown className="cf-icon cf-icon--sm" aria-hidden="true" />
      </button>
      {open && (
        <div className="map-selector__menu" role="menu" aria-label={t('map.maps')}>
          {maps.map((map) => (
            <button
              key={map.id}
              type="button"
              role="menuitemradio"
              aria-checked={map.id === shown.id}
              className="map-selector__item"
              data-open={map.open}
              onClick={() => {
                setOpen(false)
                onChoose(map.id)
              }}
            >
              <Check className="cf-icon cf-icon--sm" aria-hidden="true" />
              <span>{map.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface LevelCrumbsProps {
  map: WayfinderMap
  level: Ticket
  /** Opens a Parent Ticket, or the Map's own level with null. */
  onOpen(ticketId: string | null): void
}

/** Inside a Parent Ticket: a back button to the level above and a breadcrumb from the Map down. */
function LevelCrumbs({ map, level, onOpen }: LevelCrumbsProps): ReactNode {
  const { t } = useTranslation()
  const ancestors: Ticket[] = []
  for (let at = level.parent; at !== null; ) {
    const ticket = map.tickets.find((each) => each.id === at)
    if (!ticket) break
    ancestors.unshift(ticket)
    at = ticket.parent
  }
  const above = ancestors.at(-1)
  return (
    <>
      <IconButton
        icon={ChevronLeft}
        label={t('map.back', { name: above?.name ?? map.name })}
        onClick={() => onOpen(above?.id ?? null)}
      />
      <nav className="cf-crumbs map-crumbs" aria-label={t('map.crumbs')}>
        {[{ id: null, name: map.name }, ...ancestors].map(({ id, name }) => (
          <span key={id ?? ''} className="map-crumbs__step">
            <button type="button" title={name} onClick={() => onOpen(id)}>
              {name}
            </button>
            <ChevronRight className="cf-icon cf-icon--sm" aria-hidden="true" />
          </span>
        ))}
        <span aria-current="page" title={level.name}>
          {level.name}
        </span>
      </nav>
    </>
  )
}

interface MapViewProps {
  map: WayfinderMap
  /** The opened Parent Ticket, whose Sub-tickets the panel shows; null for the Map's own level. */
  level: Ticket | null
  onOpen(ticketId: string): void
  /** The Tree view, shown in place of the graph; false for the graph. */
  tree: ReactNode
  sessions: SessionSummary[]
  displayedSessionId: string | null
  onDisplaySession(id: string): void
}

function MapView({ map, level, onOpen, tree, sessions, displayedSessionId, onDisplaySession }: MapViewProps): ReactNode {
  const { t } = useTranslation()
  const [showDecided, setShowDecided] = useState(false)
  const levelId = level?.id ?? null
  const decided = map.tickets.filter((ticket) => ticket.parent === levelId && map.decided.includes(ticket.id))
  const ticketSessions = useMemo(() => {
    const byTicket = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      const link = session.wayfinder
      if (link?.mapId !== map.id || !link.ticket) continue
      // A Session the user hid carries no badge, unless it is the one displayed.
      if (session.hidden && session.id !== displayedSessionId) continue
      byTicket.set(link.ticket.id, [...(byTicket.get(link.ticket.id) ?? []), session])
    }
    return byTicket
  }, [sessions, map.id, displayedSessionId])

  return (
    <>
      {level ? (
        <Lead key={level.id} label={t('map.question')} text={level.question}>
          <Rollup ticket={level} blockers={openBlockerNames(map, level)} />
        </Lead>
      ) : (
        <Lead key="" label={t('map.destination')} text={map.destination} />
      )}
      {tree || (
        <div className="cf-map map-area">
          <svg className="cf-map__contours" viewBox="0 0 400 560" preserveAspectRatio="none" aria-hidden="true">
            {[70, 150, 230, 310, 390, 470, 550].map((y, i) => (
              <path key={y} d={`M-20 ${y} C ${80 + i * 10} ${y - 40}, ${180 + i * 10} ${y + 50}, 420 ${y - 20}`} />
            ))}
          </svg>
          {decided.length > 0 && (
            <div className="map-decided">
              <div className="map-decided__head">
                <span className="cf-eyebrow" id="map-decided-label">
                  {t('map.decided')}
                </span>
                <span className="cf-chip cf-chip--outline">{decided.length}</span>
                <button
                  type="button"
                  className="cf-btn cf-btn--ghost map-link-button"
                  aria-pressed={showDecided}
                  onClick={() => setShowDecided(!showDecided)}
                >
                  {showDecided ? t('map.hideLinks') : t('map.showLinks')}
                </button>
              </div>
              <ul className="cf-decided" aria-labelledby="map-decided-label">
                {decided.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="cf-chip"
                    title={ticket.name}
                    aria-current={ticketSessions.get(ticket.id)?.some((s) => s.id === displayedSessionId) || undefined}
                  >
                    <Check className="cf-icon cf-icon--sm" aria-hidden="true" />
                    <span>{ticket.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <MapGraph
            map={map}
            level={levelId}
            showDecided={showDecided}
            ticketSessions={ticketSessions}
            displayedSessionId={displayedSessionId}
            onDisplaySession={onDisplaySession}
            onOpen={onOpen}
          />
        </div>
      )}
      {!level && (
        <div className="map-sections">
          <MapSection id="decisions" title={t('map.section.decisionsSoFar')} markdown={map.decisionsSoFar} />
          <MapSection id="fog" title={t('map.section.notYetSpecified')} markdown={map.notYetSpecified} />
          <MapSection id="scope" title={t('map.section.outOfScope')} markdown={map.outOfScope} />
        </div>
      )}
    </>
  )
}

interface LeadProps {
  label: string
  text: string
  children?: ReactNode
}

/**
 * What the shown level leads to: the Map's Destination, or an opened Parent Ticket's question.
 * The text is clamped to three lines with "Show all" when it is longer.
 */
function Lead({ label, text, children }: LeadProps): ReactNode {
  const { t } = useTranslation()
  const labelId = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (element && !expanded) setOverflowing(element.scrollHeight > element.clientHeight + 1)
  }, [text, expanded])

  return (
    <section className="cf-destination" aria-labelledby={labelId}>
      <span className="cf-eyebrow" id={labelId}>
        {label}
      </span>
      <span ref={ref} className="map-destination__text" data-expanded={expanded}>
        {text}
      </span>
      {(overflowing || expanded) && (
        <button type="button" className="cf-btn cf-btn--ghost map-link-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('map.showLess') : t('map.showAll')}
        </button>
      )}
      {children}
    </section>
  )
}

interface MapSectionProps {
  id: string
  title: string
  markdown: string
}

/** One collapsible section of the Map's text, closed at first. */
function MapSection({ id, title, markdown }: MapSectionProps): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const count = itemCount(markdown)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <button
        type="button"
        className="cf-section-head map-section-head"
        aria-expanded={open}
        aria-controls={`map-section-${id}`}
        onClick={() => setOpen(!open)}
      >
        <Chevron className="cf-icon cf-icon--sm" aria-hidden="true" />
        <span className="cf-eyebrow">{title}</span>
        {count > 0 && <span className="cf-chip cf-chip--outline">{count}</span>}
      </button>
      {open && (
        <section id={`map-section-${id}`} className="map-section" aria-label={title}>
          {markdown ? <MapText markdown={markdown} /> : <p className="cf-muted">{t('map.sectionEmpty')}</p>}
        </section>
      )}
    </>
  )
}

interface MapRailProps {
  onExpand(): void
}

export function MapRail({ onExpand }: MapRailProps): ReactNode {
  const { t } = useTranslation()
  return <IconButton icon={PanelRightOpen} label={t('map.expand')} onClick={onExpand} />
}
