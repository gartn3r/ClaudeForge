import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState, ClaudeCodeStatus, MapListing, PanelId } from '../../shared/api'
import { api, onEvent } from './api'
import { Explorer, ExplorerRail, useSessionCatalog } from './components/Explorer'
import { FirstRun } from './components/FirstRun'
import { MapPanel, MapRail, shownMap } from './components/MapPanel'
import { SidePanel } from './components/SidePanel'
import { TerminalArea } from './components/TerminalArea'
import { TitleBar } from './components/TitleBar'

interface AppProps {
  initialState: AppState
  initialClaudeCode: ClaudeCodeStatus
  /** The folder ClaudeForge started in: the displayed Project until a Session is displayed. */
  project: string
}

/** Whether two paths name the same folder; Windows paths ignore case and slash direction. */
const samePath = (a: string, b: string): boolean => {
  const key = (path: string): string => path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return key(a) === key(b)
}

export function App({ initialState, initialClaudeCode, project: startProject }: AppProps): ReactNode {
  const { t } = useTranslation()
  // App state lives in the backend; the interface shows the last state it pushed.
  const [state, setState] = useState(initialState)
  const [resizing, setResizing] = useState(false)
  const [claudeCode, setClaudeCode] = useState(initialClaudeCode)

  useEffect(() => onEvent('appState.changed', setState), [])

  // The displayed Session sets the displayed Project, whose Map the Map panel follows.
  const catalog = useSessionCatalog()
  const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(null)
  const displayed = catalog
    ?.flatMap((group) => group.sessions.map((session) => ({ group, session })))
    .find(({ session }) => session.id === displayedSessionId)
  const project = displayed?.group.path ?? startProject
  const projectSessions = catalog?.find((group) => samePath(group.path, project))?.sessions ?? []

  const collapseHandler = (panel: PanelId, collapsed: boolean) => () =>
    void api.appState.write({ layout: { [panel]: { collapsed } } })

  const [maps, setMaps] = useState<{ project: string; listing: MapListing } | null>(null)
  // Expanding the panel of a Project with no Map shows it anyway, until the Project changes.
  const [mapOpenedAnyway, setMapOpenedAnyway] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void api.map.list(project).then((listing) => current && setMaps({ project, listing }))
    return () => {
      current = false
    }
  }, [project])
  const listing = maps?.project === project ? maps.listing : null
  const noMap = listing?.tracker.kind === 'local-markdown' && !shownMap(listing)
  // The panel collapses on its own without a Map; the user's own setting stays as it was.
  const mapLayout = noMap && mapOpenedAnyway !== project ? { ...state.layout.map, collapsed: true } : state.layout.map
  const expandMap = (): void => {
    setMapOpenedAnyway(project)
    if (state.layout.map.collapsed) collapseHandler('map', false)()
  }

  if (claudeCode.state !== 'found') {
    return (
      <div className="shell">
        <TitleBar sessionTabs={false} />
        <FirstRun problem={claudeCode} onStatus={setClaudeCode} />
      </div>
    )
  }

  return (
    <div className="shell" data-resizing={resizing}>
      <TitleBar />
      <div className="columns">
        <SidePanel
          id="explorer"
          side="left"
          layout={state.layout.explorer}
          label={t('explorer.label')}
          resizeLabel={t('explorer.resize')}
          rail={<ExplorerRail onExpand={collapseHandler('explorer', false)} />}
          onResizingChange={setResizing}
        >
          <Explorer
            projects={catalog}
            displayedSessionId={displayedSessionId}
            onDisplaySession={setDisplayedSessionId}
            onCollapse={collapseHandler('explorer', true)}
          />
        </SidePanel>
        <TerminalArea />
        <SidePanel
          id="map"
          side="right"
          layout={mapLayout}
          label={t('map.label')}
          resizeLabel={t('map.resize')}
          rail={<MapRail onExpand={expandMap} />}
          onResizingChange={setResizing}
        >
          <MapPanel
            project={project}
            listing={listing}
            sessions={projectSessions}
            displayedSession={displayed?.session ?? null}
            onDisplaySession={setDisplayedSessionId}
            onCollapse={collapseHandler('map', true)}
          />
        </SidePanel>
      </div>
    </div>
  )
}
