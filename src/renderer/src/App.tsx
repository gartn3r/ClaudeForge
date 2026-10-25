import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState, ClaudeCodeStatus, MapListing, PanelId } from '../../shared/api'
import { api, onEvent } from './api'
import { Explorer, ExplorerRail, useSessionCatalog } from './components/Explorer'
import { FirstRun } from './components/FirstRun'
import { MapPanel, MapRail, shownMap } from './components/MapPanel'
import { SettingsMenu } from './components/SettingsMenu'
import { SessionTabs } from './components/SessionTabs'
import { SidePanel } from './components/SidePanel'
import { TerminalArea } from './components/TerminalArea'
import { TitleBar } from './components/TitleBar'
import { useHostedSessions } from './terminal/hosted-sessions'
import type { SessionLaunch } from './terminal/hosted-terminal'

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

  // The displayed Session sets the displayed Project, whose Map the Map panel follows: the one
  // clicked in the explorer, else the Hosted session on show.
  const catalog = useSessionCatalog()
  const hosted = useHostedSessions()
  const activeTab = hosted.tabs.find((tab) => tab.key === hosted.activeKey)
  const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(null)
  const displayed = catalog
    ?.flatMap((group) => group.sessions.map((session) => ({ group, session })))
    .find(({ session }) => session.id === displayedSessionId)
  const displayedProject = displayed?.group.path ?? activeTab?.project ?? startProject
  // The start folder keeps its own spelling while the displayed Session runs in it.
  const project = samePath(displayedProject, startProject) ? startProject : displayedProject

  // A Hosted session started anywhere goes on show, so its Project becomes the displayed one.
  const startHostedSession = (folder: string, launch?: SessionLaunch): void => {
    setDisplayedSessionId(null)
    hosted.sessions.start(folder, state.gpuRendering, launch)
  }
  const selectHostedSession = (key: string): void => {
    setDisplayedSessionId(null)
    hosted.sessions.select(key)
  }
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
  const linkedMapId = displayed?.session.wayfinder?.mapId
  // An unsupported Tracker or one gh cannot read keeps the panel open, to say why it is empty.
  const noMap =
    !!listing &&
    listing.tracker.kind !== 'unsupported' &&
    !listing.problem &&
    !shownMap(listing) &&
    !listing.maps.some((map) => map.id === linkedMapId)
  // The panel collapses on its own without a Map; the user's own setting stays as it was.
  const mapLayout = noMap && mapOpenedAnyway !== project ? { ...state.layout.map, collapsed: true } : state.layout.map
  const expandMap = (): void => {
    setMapOpenedAnyway(project)
    if (state.layout.map.collapsed) collapseHandler('map', false)()
  }

  if (claudeCode.state !== 'found') {
    return (
      <div className="shell">
        <TitleBar />
        <FirstRun problem={claudeCode} onStatus={setClaudeCode} />
      </div>
    )
  }

  return (
    <div className="shell" data-resizing={resizing}>
      <TitleBar
        tabs={
          <SessionTabs
            tabs={hosted.tabs}
            activeKey={hosted.activeKey}
            onSelect={selectHostedSession}
            onClose={(key) => hosted.sessions.close(key)}
            onNew={() => startHostedSession(project)}
          />
        }
        settings={<SettingsMenu state={state} />}
      />
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
            onStartSession={startHostedSession}
            project={project}
            onCollapse={collapseHandler('explorer', true)}
          />
        </SidePanel>
        <TerminalArea
          tabs={hosted.tabs}
          activeKey={hosted.activeKey}
          gpuRendering={state.gpuRendering}
          onStart={startHostedSession}
        />
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
            preferences={state.maps[project] ?? {}}
            onDisplaySession={setDisplayedSessionId}
            onCollapse={collapseHandler('map', true)}
          />
        </SidePanel>
      </div>
    </div>
  )
}
