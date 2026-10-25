import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState, ClaudeCodeStatus, PanelId } from '../../shared/api'
import { api, onEvent } from './api'
import { Explorer, ExplorerRail } from './components/Explorer'
import { FirstRun } from './components/FirstRun'
import { MapPanel, MapRail } from './components/MapPanel'
import { SidePanel } from './components/SidePanel'
import { TerminalArea } from './components/TerminalArea'
import { TitleBar } from './components/TitleBar'

interface AppProps {
  initialState: AppState
  initialClaudeCode: ClaudeCodeStatus
}

export function App({ initialState, initialClaudeCode }: AppProps): ReactNode {
  const { t } = useTranslation()
  // App state lives in the backend; the interface shows the last state it pushed.
  const [state, setState] = useState(initialState)
  const [resizing, setResizing] = useState(false)
  const [claudeCode, setClaudeCode] = useState(initialClaudeCode)

  useEffect(() => onEvent('appState.changed', setState), [])

  const collapseHandler = (panel: PanelId, collapsed: boolean) => () =>
    void api.appState.write({ layout: { [panel]: { collapsed } } })

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
          <Explorer onCollapse={collapseHandler('explorer', true)} />
        </SidePanel>
        <TerminalArea />
        <SidePanel
          id="map"
          side="right"
          layout={state.layout.map}
          label={t('map.label')}
          resizeLabel={t('map.resize')}
          rail={<MapRail onExpand={collapseHandler('map', false)} />}
          onResizingChange={setResizing}
        >
          <MapPanel onCollapse={collapseHandler('map', true)} />
        </SidePanel>
      </div>
    </div>
  )
}
