import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState, ClaudeCodeStatus, MapListing, PanelId } from '../../shared/api'
import { api, onEvent } from './api'
import { Explorer, ExplorerRail } from './components/Explorer'
import { FirstRun } from './components/FirstRun'
import { MapPanel, MapRail, shownMap } from './components/MapPanel'
import { SettingsMenu } from './components/SettingsMenu'
import { SidePanel } from './components/SidePanel'
import { TerminalArea } from './components/TerminalArea'
import { TitleBar } from './components/TitleBar'

interface AppProps {
  initialState: AppState
  initialClaudeCode: ClaudeCodeStatus
  /** The displayed Project, whose Map the Map panel shows. */
  project: string
}

export function App({ initialState, initialClaudeCode, project }: AppProps): ReactNode {
  const { t } = useTranslation()
  // App state lives in the backend; the interface shows the last state it pushed.
  const [state, setState] = useState(initialState)
  const [resizing, setResizing] = useState(false)
  const [claudeCode, setClaudeCode] = useState(initialClaudeCode)

  useEffect(() => onEvent('appState.changed', setState), [])

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
      <TitleBar settings={<SettingsMenu state={state} />} />
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
          <Explorer onCollapse={collapseHandler('explorer', true)} />
        </SidePanel>
        <TerminalArea gpuRendering={state.gpuRendering} />
        <SidePanel
          id="map"
          side="right"
          layout={mapLayout}
          label={t('map.label')}
          resizeLabel={t('map.resize')}
          rail={<MapRail onExpand={expandMap} />}
          onResizingChange={setResizing}
        >
          <MapPanel project={project} listing={listing} onCollapse={collapseHandler('map', true)} />
        </SidePanel>
      </div>
    </div>
  )
}
