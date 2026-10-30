import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState, ClaudeCodeStatus, MapListing, PanelId, Shortcut } from '../../shared/api'
import { commandText } from '../../shared/shortcuts'
import { api, onEvent } from './api'
import { CloseWarning } from './components/CloseWarning'
import { Explorer, ExplorerRail, useSessionCatalog } from './components/Explorer'
import { ExtensionsBar } from './components/ExtensionsMenu'
import { FirstRun } from './components/FirstRun'
import { MapPanel, shownMap } from './components/MapPanel'
import { SettingsMenu } from './components/SettingsMenu'
import { SessionTabs } from './components/SessionTabs'
import { BusyNotice, ShortcutDialog, ShortcutsCard, ShortcutsRail, lacksSkill, useProjectSkills } from './components/Shortcuts'
import { SidePanel } from './components/SidePanel'
import { TerminalArea } from './components/TerminalArea'
import { TitleBar } from './components/TitleBar'
import { useEditorTabs } from './editor/editor-tabs'
import { ExplorerColumn } from './elements/ExplorerColumn'
import { columnProps, isShown, useInterfaceElements } from './elements/interface-elements'
import { RightPanel, RightPanelRail, useRightPanel, useRightPanelLabels } from './elements/RightPanel'
import { MAP_TAB } from './elements/right-panel'
import { RestoreDefaultButton, TitleBarMenus } from './elements/TitleBarMenus'
import { tabTitle, useHostedSessions, useSavedTabs } from './terminal/hosted-sessions'
import type { SessionLaunch } from './terminal/hosted-terminal'
import { useSessionNotifications } from './terminal/session-notifications'
import { planTyping, samePath } from './terminal/typing'
import { useWebTabs } from './web/web-tabs'

interface AppProps {
  initialState: AppState
  initialClaudeCode: ClaudeCodeStatus
  /** The folder ClaudeForge started in: the displayed Project until a Session is displayed. */
  project: string
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
  // The tabs open when ClaudeForge last closed come back dormant, and the open ones are kept for next time.
  const hosted = useHostedSessions(initialState.tabs, initialState.gpuRendering)
  useSavedTabs(hosted.tabs, catalog, state.tabs)
  // Skill and subagent editors share the tab strip; while one is on show, no terminal is.
  const editing = useEditorTabs()
  // The backend asks before closing the window while an editor holds unsaved text.
  // Joined, so the backend hears again only when the set changes (editor keys hold no space).
  const unsavedKeys = editing.tabs.filter((tab) => tab.dirty).map((tab) => tab.key).join(' ')
  useEffect(() => void api.window.setUnsavedEditors(unsavedKeys ? unsavedKeys.split(' ') : []), [unsavedKeys])
  // Web tabs share it too, and come back on the next start like the Hosted sessions' tabs.
  const webbing = useWebTabs(state.webTabs)
  const webShortcuts = state.shortcuts.flatMap((shortcut) => (shortcut.kind === 'web' ? [shortcut] : []))
  const webIds = webShortcuts.map((shortcut) => shortcut.id).join(' ')
  // A Web tab closes with its Shortcut.
  useEffect(() => webbing.web.keepOnly(new Set(webIds.split(' '))), [webbing.web, webIds])
  const webTabs = webbing.tabs.flatMap((tab) => {
    const shortcut = webShortcuts.find((each) => each.id === tab.shortcutId)
    return shortcut ? [{ ...tab, title: shortcut.name, address: shortcut.address }] : []
  })
  const activeTab = hosted.tabs.find((tab) => tab.key === hosted.activeKey)
  const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(null)
  const displayed = catalog
    ?.flatMap((group) => group.sessions.map((session) => ({ group, session })))
    .find(({ session }) => session.id === displayedSessionId)
  const displayedProject = displayed?.group.path ?? activeTab?.project ?? startProject
  // The start folder keeps its own spelling while the displayed Session runs in it.
  const project = samePath(displayedProject, startProject) ? startProject : displayedProject
  // ClaudeForge's own Elements and the displayed Project's Created ones, as the user or Claude set them.
  const elements = useInterfaceElements(project, state.layout)
  const rightPanelElement = elements.own('right-panel')

  // A Hosted session started anywhere goes on show, so its Project becomes the displayed one.
  const startHostedSession = (folder: string, launch?: SessionLaunch): void => {
    setDisplayedSessionId(null)
    editing.editors.deselect()
    webbing.web.deselect()
    hosted.sessions.start(folder, state.gpuRendering, launch)
  }
  const selectHostedSession = (key: string): void => {
    setDisplayedSessionId(null)
    editing.editors.deselect()
    webbing.web.deselect()
    hosted.sessions.select(key)
  }
  // A Hosted session is displayed in its own tab; any other Session in the explorer and the Map panel.
  const displaySession = (id: string): void => {
    const hostedId = catalog?.flatMap((group) => group.sessions).find((session) => session.id === id)?.hostedId
    const tab = hostedId && hosted.tabs.find((each) => each.terminal.hostedId === hostedId)
    if (tab) selectHostedSession(tab.key)
    else setDisplayedSessionId(id)
  }
  const showEditor = (show: () => void): void => {
    webbing.web.deselect()
    show()
  }
  const showWebTab = (show: () => void): void => {
    editing.editors.deselect()
    show()
  }
  const shownKey = editing.activeKey ?? webbing.activeKey ?? hosted.activeKey
  // A Session behind an editor or a Web tab is not on show, so it notifies like one in the background.
  const shownHostedKey = editing.activeKey === null && webbing.activeKey === null ? hosted.activeKey : null
  /** The Hosted session on show, while its `claude` can be typed into. */
  const shownHosted = hosted.tabs.find((tab) => tab.key === shownHostedKey && !tab.dormant && !tab.end)
  useSessionNotifications(hosted.sessions, shownHostedKey, state.notifications, selectHostedSession)
  const projectSessions = catalog?.find((group) => samePath(group.path, project))?.sessions ?? []

  // A Skill shortcut types into the Hosted session on show, else into a new Session of the displayed
  // Project: that Project's skills say which Skill shortcuts are greyed out. They are read only while
  // a Shortcut names a skill.
  const skillTarget = shownHosted?.project ?? project
  const namesSkill = state.shortcuts.some((shortcut) => shortcut.kind === 'skill' && shortcut.command.mode === 'skill')
  const targetSkills = useProjectSkills(namesSkill ? skillTarget : null)
  const [editingShortcut, setEditingShortcut] = useState<{ shortcut: Shortcut | null } | null>(null)
  /** The Session a Skill shortcut could not type into, while the notice saying so shows. */
  const [busySession, setBusySession] = useState<string | null>(null)
  const dismissBusy = useCallback(() => setBusySession(null), [])
  /**
   * Types a command without sending it, by the Skill shortcut rule; `owner` is the Project an action
   * belongs to, null for a Skill shortcut. `name` says where the command came from.
   */
  const typeCommand = (command: string, name: string, owner: string | null): void => {
    const plan = planTyping(shownHosted ?? null, owner, project)
    if (plan.kind === 'start') return startHostedSession(plan.project, { kind: 'new', typed: { command, shortcut: name } })
    if (plan.kind === 'busy' || !shownHosted!.terminal.typeCommand(command)) setBusySession(tabTitle(shownHosted!))
  }
  const openShortcut = (shortcut: Shortcut): void => {
    if (shortcut.kind === 'web') return showWebTab(() => webbing.web.open(shortcut.id))
    if (lacksSkill(shortcut, targetSkills)) return
    typeCommand(commandText(shortcut.command), shortcut.name, null)
  }
  const shortcutsProps = {
    shortcuts: state.shortcuts,
    target: skillTarget,
    skills: targetSkills,
    onOpen: openShortcut,
    onAdd: () => setEditingShortcut({ shortcut: null })
  }

  const collapseHandler = (panel: PanelId, collapsed: boolean) => () =>
    void api.appState.write({ layout: { [panel]: { collapsed } } })

  // The displayed Project's Maps, listed again whenever the backend says they may have changed.
  const [maps, setMaps] = useState<{ project: string; listing: MapListing; listedAt: number } | null>(null)
  const [mapRevision, setMapRevision] = useState(0)
  useEffect(
    () => onEvent('map.changed', (change) => samePath(change.project, project) && setMapRevision((revision) => revision + 1)),
    [project]
  )
  useEffect(() => {
    let current = true
    void api.map.list(project).then((listing) => {
      if (!current) return
      setMaps((previous) =>
        // A refresh GitHub could not answer (offline, say) keeps the Maps already shown.
        listing.problem === 'gh-failed' && previous?.project === project && !previous.listing.problem
          ? previous
          : { project, listing, listedAt: Date.now() }
      )
    })
    return () => {
      current = false
    }
  }, [project, mapRevision])
  const listing = maps?.project === project ? maps.listing : null
  const linkedMapId = displayed?.session.wayfinder?.mapId
  // An unsupported Tracker or one gh cannot read keeps the panel open, to say why it is empty.
  const noMap =
    !!listing &&
    listing.tracker.kind !== 'unsupported' &&
    !listing.problem &&
    !shownMap(listing) &&
    !listing.maps.some((map) => map.id === linkedMapId)
  // The Right panel holds the Map Panel tab and the displayed Project's Created Panel tabs. It
  // collapses on its own with neither a Map nor any other Panel tab; the user's own setting stays as it was.
  const expandRightPanel = useCallback(() => void api.appState.write({ layout: { map: { collapsed: false } } }), [])
  const rightPanel = useRightPanel({
    project,
    elements: elements.listed,
    hasMap: !noMap,
    layoutCollapsed: state.layout.map.collapsed,
    expand: expandRightPanel
  })
  const rightPanelLabels = useRightPanelLabels(rightPanel.state.shown)
  const mapLayout = { ...state.layout.map, collapsed: rightPanel.collapsed }
  const expandMap = (): void => {
    rightPanel.openAnyway()
    if (state.layout.map.collapsed) expandRightPanel()
  }
  // The backend keeps the displayed Project's Maps fresh, polling GitHub only while the Map is on show.
  const mapShown = !mapLayout.collapsed && rightPanel.state.shown?.id === MAP_TAB
  useEffect(() => void api.map.watch(project, mapShown), [project, mapShown])

  if (claudeCode.state !== 'found') {
    return (
      <div className="shell">
        <TitleBar appTitle={state.appTitle} />
        <FirstRun problem={claudeCode} onStatus={setClaudeCode} />
      </div>
    )
  }

  return (
    <div className="shell" data-resizing={resizing}>
      <TitleBar
        appTitle={state.appTitle}
        tabs={
          <SessionTabs
            tabs={hosted.tabs}
            editors={editing.tabs}
            webTabs={webTabs}
            activeKey={shownKey}
            onSelect={selectHostedSession}
            onClose={(key) => hosted.sessions.close(key)}
            onSelectEditor={(key) => showEditor(() => editing.editors.select(key))}
            onCloseEditor={(key) => editing.editors.close(key)}
            onSelectWeb={(key) => showWebTab(() => webbing.web.select(key))}
            onCloseWeb={(key) => webbing.web.close(key)}
            onNew={() => startHostedSession(project)}
          />
        }
        menus={
          <>
            <TitleBarMenus elements={elements} project={project} onType={typeCommand} />
            <RestoreDefaultButton />
          </>
        }
        settings={<SettingsMenu state={state} />}
        frame={elements.frame(elements.own('title-bar'))}
      />
      <div className="columns">
        {isShown(elements.own('explorer')) && (
        <SidePanel
          id="explorer"
          side="left"
          layout={state.layout.explorer}
          label={t('explorer.label')}
          resizeLabel={t('explorer.resize')}
          rail={
            <ExplorerRail onExpand={collapseHandler('explorer', false)}>
              {isShown(elements.own('shortcuts')) && <ShortcutsRail {...shortcutsProps} />}
            </ExplorerRail>
          }
          onResizingChange={setResizing}
          {...columnProps(elements.frame(elements.own('explorer')))}
        >
          <ExplorerColumn
            elements={elements}
            project={project}
            onType={typeCommand}
            shortcuts={(frame) => (
              <ShortcutsCard
                {...shortcutsProps}
                shownWebShortcut={webbing.tabs.find((tab) => tab.key === shownKey)?.shortcutId ?? null}
                onEdit={(shortcut) => setEditingShortcut({ shortcut })}
                frame={frame}
              />
            )}
            sessions={(frame) => (
              <Explorer
                projects={catalog}
                displayedSessionId={displayedSessionId}
                onDisplaySession={displaySession}
                onStartSession={startHostedSession}
                onCollapse={collapseHandler('explorer', true)}
                frame={frame}
              />
            )}
            extensions={(frame) => (
              <ExtensionsBar
                project={project}
                hostedTabs={hosted.tabs}
                onShowHostedSession={selectHostedSession}
                onEdit={(target) => showEditor(() => editing.editors.open(target))}
                frame={frame}
              />
            )}
          />
        </SidePanel>
        )}
        <TerminalArea
          tabs={hosted.tabs}
          editors={editing.tabs}
          webTabs={webTabs}
          activeKey={shownKey}
          gpuRendering={state.gpuRendering}
          onStart={startHostedSession}
          onClose={(key) => hosted.sessions.close(key)}
          onEditorDirtyChange={(key, dirty) => editing.editors.setDirty(key, dirty)}
          onEditorRename={(key, name) => editing.editors.rename(key, name)}
          frame={elements.frame(elements.own('terminal-area'))}
        />
        {isShown(rightPanelElement) && (
        <SidePanel
          id="map"
          side="right"
          layout={mapLayout}
          label={rightPanelLabels.label}
          resizeLabel={rightPanelLabels.resize}
          rail={
            <RightPanelRail
              label={rightPanelLabels.expand}
              marked={rightPanel.state.tabs.some((tab) => tab.attention === 'mark')}
              onExpand={expandMap}
            />
          }
          onResizingChange={setResizing}
          {...columnProps(elements.frame(rightPanelElement), { railOnly: true })}
        >
          <RightPanel
            state={rightPanel.state}
            project={project}
            map={
              <MapPanel
                project={project}
                listing={listing}
                revision={mapRevision}
                listedAt={maps?.project === project ? maps.listedAt : null}
                sessions={projectSessions}
                displayedSession={displayed?.session ?? null}
                preferences={state.maps[project] ?? {}}
                onDisplaySession={displaySession}
                onStartSession={(typed) => startHostedSession(project, { kind: 'new', typed })}
              />
            }
            collapseLabel={rightPanelLabels.collapse}
            onChoose={rightPanel.choose}
            onCollapse={collapseHandler('map', true)}
            onType={typeCommand}
          />
        </SidePanel>
        )}
      </div>
      <CloseWarning tabs={hosted.tabs} editors={editing.tabs} />
      {editingShortcut && (
        <ShortcutDialog
          editing={editingShortcut.shortcut}
          shortcuts={state.shortcuts}
          project={project}
          onDone={() => setEditingShortcut(null)}
        />
      )}
      {busySession && <BusyNotice session={busySession} onDismiss={dismissBusy} />}
      {elements.menus}
    </div>
  )
}
