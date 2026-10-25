import { Check, ChevronDown, ChevronRight, Map as MapIcon, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { MapListing, MapSummary, TrackerProblem, WayfinderMap } from '../../../shared/api'
import { api } from '../api'
import { IconButton } from './IconButton'
import { MapGraph } from './MapGraph'
import { MapText, itemCount } from './MapText'

/** The Map the panel shows: the most recently updated open one. */
export const shownMap = (listing: MapListing): MapSummary | undefined => listing.maps.find((map) => map.open)

const PROBLEM_MESSAGES = {
  'gh-missing': 'map.problem.ghMissing',
  'gh-signed-out': 'map.problem.ghSignedOut',
  'no-github-repository': 'map.problem.noGitHubRepository',
  'gh-failed': 'map.problem.ghFailed'
} as const satisfies Record<TrackerProblem, string>

/** A load of one Map of one Project, and how it went. */
type Loaded = { project: string; mapId: string } & ({ map: WayfinderMap } | { error: true })

interface MapPanelProps {
  project: string
  /** The Project's Tracker and Maps; null while they load. */
  listing: MapListing | null
  onCollapse(): void
}

/** The Map panel: the Wayfinder Map of the displayed Session's Project. */
export function MapPanel({ project, listing, onCollapse }: MapPanelProps): ReactNode {
  const { t } = useTranslation()
  const summary = listing && shownMap(listing)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

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
  }
  else if (map) body = <MapView map={map} />

  return (
    <>
      <div className="cf-panel-head">
        <span className="cf-eyebrow">{t('map.heading')}</span>
        {map && (
          <h2 className="map-name" title={map.name}>
            <MapIcon className="cf-icon cf-icon--sm" aria-hidden="true" />
            <span>{map.name}</span>
          </h2>
        )}
        <IconButton icon={PanelRightClose} label={t('map.collapse')} onClick={onCollapse} />
      </div>
      <div className="map-panel__body">{body}</div>
    </>
  )
}

function MapView({ map }: { map: WayfinderMap }): ReactNode {
  const { t } = useTranslation()
  const [showDecided, setShowDecided] = useState(false)
  const decided = map.tickets.filter((ticket) => map.decided.includes(ticket.id))

  return (
    <>
      <Destination text={map.destination} />
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
                <li key={ticket.id} className="cf-chip" title={ticket.name}>
                  <Check className="cf-icon cf-icon--sm" aria-hidden="true" />
                  <span>{ticket.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <MapGraph map={map} showDecided={showDecided} />
      </div>
      <div className="map-sections">
        <MapSection id="decisions" title={t('map.section.decisionsSoFar')} markdown={map.decisionsSoFar} />
        <MapSection id="fog" title={t('map.section.notYetSpecified')} markdown={map.notYetSpecified} />
        <MapSection id="scope" title={t('map.section.outOfScope')} markdown={map.outOfScope} />
      </div>
    </>
  )
}

/** The Destination, clamped to three lines with "Show all" when it is longer. */
function Destination({ text }: { text: string }): ReactNode {
  const { t } = useTranslation()
  const ref = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (element && !expanded) setOverflowing(element.scrollHeight > element.clientHeight + 1)
  }, [text, expanded])

  return (
    <section className="cf-destination" aria-labelledby="map-destination-label">
      <span className="cf-eyebrow" id="map-destination-label">
        {t('map.destination')}
      </span>
      <span ref={ref} className="map-destination__text" data-expanded={expanded}>
        {text}
      </span>
      {(overflowing || expanded) && (
        <button type="button" className="cf-btn cf-btn--ghost map-link-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('map.showLess') : t('map.showAll')}
        </button>
      )}
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
