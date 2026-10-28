// The backend: every service of the typed backend API, in plain Node with no
// Electron import, so Seam 1 tests drive it directly. The main process wires
// it to IPC (see src/main/ipc.ts).

import { stat } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import type {
  AppState,
  AppStatePatch,
  BackendApi,
  ClaudeCodeStatus,
  EventName,
  HostedSession,
  SessionDeletion,
  TerminalSize,
  WindowNotification
} from '../shared/api'
import type { Asker } from '../shared/elements'
import { opensInBrowser } from '../shared/shortcuts'
import { AppStateStore } from './app-state'
import { locateClaudeCode, type Environment } from './claude-code'
import { BackendEventEmitter, type Listener } from './events'
import { Elements } from './elements'
import { createExtensionService } from './extensions'
import { resolveLanguage } from './language'
import { createMapService } from './maps'
import { resolveWayfinderLink } from './maps/links'
import { MapRefresh } from './maps/refresh'
import type { TrashItem } from './recycle-bin'
import { SessionCatalog } from './session-catalog'
import { SessionHost } from './session-host'
import { SessionIdStore } from './session-ids'
import { Updates, type Updater } from './updates'
import { placeFolder } from './worktree'

export type { Updater } from './updates'

/** The window the interface runs in, as the backend sees it. */
export interface WindowHost {
  minimize(): void
  toggleMaximize(): void
  /** Closes the window for good: the user's request to close it has been dealt with. */
  close(): void
  /**
   * Calls back when Windows asks to close the window (Alt+F4, the taskbar's "Close window"), which
   * stays open until `close`; returns an unsubscribe.
   */
  onCloseRequest(listener: () => void): () => void
  isMaximized(): boolean
  /** Calls back whenever the window is maximized or restored; returns an unsubscribe. */
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Whether the window is on screen: shown and not minimized. */
  isVisible(): boolean
  /** Calls back whenever the window comes on screen or leaves it (shown, hidden, minimized, restored); returns an unsubscribe. */
  onVisibilityChange(listener: (visible: boolean) => void): () => void
  /** Calls back whenever the user comes back to the window, which takes the focus; returns an unsubscribe. */
  onFocus(listener: () => void): () => void
  /** Shows a Windows notification; `onClick` runs once the user clicked it and the window came to the front. */
  notify(notification: WindowNotification, onClick: () => void): void
}

export interface BackendOptions {
  /** ClaudeForge's own data folder, where app state and the list of Session ids are kept. */
  stateDir: string
  /** The Claude Code home (`CLAUDE_CONFIG_DIR`, else `~/.claude`), whose Sessions the catalog lists. */
  claudeHome: string
  /** Windows display languages in order of preference, e.g. `['fr-FR', 'en-US']`. */
  systemLanguages: readonly string[]
  /** The environment `claude` and `gh` are looked up and run in. */
  env: Environment
  /** The folder ClaudeForge was started in; defaults to the current directory. */
  startFolder?: string
  /** Absent when no window exists (Seam 1 tests); window calls then do nothing. */
  window?: WindowHost
  /** Native dialogs; absent in Seam 1 tests unless one stands in for the user. */
  dialogs?: Dialogs
  /** Moves a deleted Session's files to the Windows Recycle Bin. */
  trashItem: TrashItem
  /** Opens issues on the desktop; absent in Seam 1 tests unless one stands in for it. */
  shell?: DesktopShell
  /** ClaudeForge's own updater; absent when it does not update itself (development builds, tests). */
  updater?: Updater
}

/** Where the desktop opens what the interface links to. */
export interface DesktopShell {
  /** Opens a web address in the default browser. */
  openUrl(url: string): Promise<void>
  /** Opens a file in the default app for its kind. */
  openFile(path: string): Promise<void>
}

/** The native dialogs the backend asks the user through. */
export interface Dialogs {
  /** Asks for the `claude` executable; undefined when the user cancels. */
  chooseClaudeExecutable(): Promise<string | undefined>
  /** Asks for a Project folder; undefined when the user cancels. */
  chooseProjectFolder(): Promise<string | undefined>
}

export interface Backend {
  api: BackendApi
  /**
   * The Elements contract as one asker reaches it: `api.elements` is the user's; the ClaudeForge CLI
   * asks in the name of the Hosted session it proved it runs in (ADR 0007).
   */
  elements(asker: Asker): BackendApi['elements']
  on<E extends EventName>(event: E, listener: Listener<E>): () => void
  dispose(): void
}

/**
 * Opens a Map's or Ticket's issue: a web address (a GitHub issue's, on github.com or a GitHub
 * Enterprise host), or a local markdown file. Anything else is refused, so the interface cannot
 * have the desktop run a program.
 */
async function openIssue(shell: DesktopShell | undefined, path: string): Promise<void> {
  if (/^https:\/\//i.test(path)) return shell?.openUrl(path)
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.md') throw new Error(`${path} is not an issue`)
  if (!(await stat(path)).isFile()) throw new Error(`${path} is not a file`)
  return shell?.openFile(path)
}

export function createBackend(options: BackendOptions): Backend {
  const events = new BackendEventEmitter()
  const appState = new AppStateStore(options.stateDir)
  const sessionIds = new SessionIdStore(options.stateDir)
  const maps = createMapService(options.env)
  const sessions = new SessionCatalog(
    options.claudeHome,
    (projects) => events.emit('sessions.changed', projects),
    async () => (await appState.read()).sessions,
    () => sessionIds.ids(),
    (project, args) => resolveWayfinderLink(maps, project, args)
  )
  const language = resolveLanguage(options.systemLanguages)
  const startFolder = options.startFolder ?? process.cwd()
  const win = options.window

  const unsubscribeMaximized = win?.onMaximizedChange((maximized) =>
    events.emit('window.maximizedChanged', { maximized })
  )

  const mapRefresh = new MapRefresh({
    onChange: (project) => events.emit('map.changed', { project }),
    visible: win?.isVisible() ?? true
  })
  const unsubscribeVisibility = win?.onVisibilityChange((visible) => mapRefresh.visibilityChanged(visible))
  const unsubscribeFocus = win?.onFocus(() => mapRefresh.focused())

  const updates = new Updates(options.updater, (status) => events.emit('updates.changed', status))

  // The last status found, so starting a Session does not run `claude --version` again.
  let claudeCode: ClaudeCodeStatus | undefined
  const locateWithChosenPath = async (): Promise<ClaudeCodeStatus> => {
    claudeCode = await locateClaudeCode({ env: options.env, userPath: (await appState.read()).claudePath })
    return claudeCode
  }

  /** The `claude` to run; throws when there is none that can run. */
  const claudePath = async (): Promise<string> => {
    const status = claudeCode?.state === 'found' ? claudeCode : await locateWithChosenPath()
    if (status.state !== 'found') throw new Error(`Claude Code cannot run: it is ${status.state}`)
    return status.path
  }

  const sessionHost = new SessionHost({
    env: options.env,
    claudeHome: options.claudeHome,
    claudePath,
    recordSession: (sessionId) => sessionIds.add(sessionId),
    onOutput: (id, data) => events.emit('sessionHost.output', { id, data }),
    onExit: (id, exitCode) => events.emit('sessionHost.exit', { id, exitCode }),
    onStatus: (id, status) => events.emit('sessionHost.status', { id, status }),
    onTurnEnd: (id, cwd) => {
      events.emit('sessionHost.turnEnded', { id, cwd })
      void mapRefresh.turnEnded(cwd)
    }
  })

  const extensions = createExtensionService({
    claudeHome: options.claudeHome,
    env: options.env,
    claudePath,
    noProjectFolder: join(options.stateDir, 'no-project'),
    hostedSessions: () => sessionHost.running()
  })

  const writeAppState = async (patch: AppStatePatch): Promise<AppState> => {
    const state = await appState.write(patch)
    // The located `claude` may no longer be the one to run.
    if (patch.claudePath !== undefined) claudeCode = undefined
    events.emit('appState.changed', state)
    return state
  }

  const elements = new Elements({
    stateDir: options.stateDir,
    layout: {
      read: async () => (await appState.read()).layout,
      write: (layout) => writeAppState({ layout })
    },
    hostedSession: async (id) => {
      const hosted = sessionHost.describe(id)
      return hosted ? { sessionId: hosted.sessionId, project: (await placeFolder(hosted.folder)).project } : null
    },
    openFile: async (path) => options.shell?.openFile(path),
    onChange: (project) => events.emit('elements.changed', { project })
  })

  /**
   * Drops the saved tabs that could never resume: those of conversations that are not Sessions (ADR
   * 0005), and those whose Session's folder is gone. Done once, before the interface first reads the
   * state, so they never come back at startup.
   */
  const dropUnresumableTabs = async (): Promise<void> => {
    const { tabs } = await appState.read()
    if (!tabs.length) return
    const listed = await sessionIds.ids()
    // A catalog that cannot be read leaves the Sessions' tabs as they are: each still says why it cannot resume.
    const missing = await sessions.current().then(
      (all) => new Set(all.filter((s) => s.folderMissing).map((s) => s.id)),
      () => new Set<string>()
    )
    const kept = tabs.filter((tab) => listed.has(tab.sessionId) && !missing.has(tab.sessionId))
    if (kept.length < tabs.length) await writeAppState({ tabs: kept })
  }
  let savedTabsChecked: Promise<void> | undefined

  /** Stores how the user tidied one Session, then pushes the catalog as it now looks. */
  const tidySession = async (id: string, preferences: NonNullable<AppStatePatch['sessions']>[string]): Promise<void> => {
    // A conversation that never ran in ClaudeForge is not managed from it: its preferences stay as they are.
    if (!(await sessionIds.ids()).has(id)) throw new Error(`There is no Session ${id}`)
    await writeAppState({ sessions: { [id]: preferences } })
    await sessions.refresh()
  }

  /** Starts `claude --resume <id>`, plus the given options, in the folder the past Session ran in. */
  const resumeSession = async (id: string, size: TerminalSize, args: string[] = []): Promise<HostedSession> => {
    const session = await sessions.find(id)
    if (!session) throw new Error(`There is no Session ${id}`)
    // Never two `claude` on one Session: an External one is read-only until it ends.
    if (session.state !== 'past') throw new Error(`Session ${id} still runs outside ClaudeForge`)
    return sessionHost.start(session.cwd, size, ['--resume', id, ...args])
  }

  /** Set once the window is closing, from then on resolving once it has. */
  let closing: Promise<void> | undefined
  /** Stops every Hosted session, then closes the window once their `claude` have ended; once only. */
  const stopSessionsAndClose = (): Promise<void> => {
    closing ??= sessionHost.stopAll().then(() => win?.close())
    return closing
  }

  /** The editor tabs holding unsaved text, by key, as the interface last said. */
  let unsavedEditors: string[] = []
  /** The user asked to close the window: warn them first about the Hosted sessions still working and the unsaved editors. */
  const requestClose = async (): Promise<void> => {
    const working = sessionHost.working()
    if ((working.length || unsavedEditors.length) && !closing)
      events.emit('window.closeRequested', { working, unsavedEditors })
    else await stopSessionsAndClose()
  }
  const unsubscribeClose = win?.onCloseRequest(() => void requestClose())

  const api: BackendApi = {
    sessionHost: {
      chooseProject: async () => (await options.dialogs?.chooseProjectFolder()) ?? null,
      start: (project, size, { prefill } = {}) =>
        sessionHost.start(project, size, prefill === undefined ? [] : ['--prefill', prefill]),
      resume: (id, size) => resumeSession(id, size),
      fork: (id, size) => resumeSession(id, size, ['--fork-session']),
      write: async (id, data) => sessionHost.write(id, data),
      resize: async (id, size) => sessionHost.resize(id, size),
      stop: async (id) => sessionHost.stop(id)
    },
    map: {
      ...maps,
      watch: (project, shown) => mapRefresh.watch(project, shown),
      refresh: async (project) => mapRefresh.refresh(project),
      openIssue: (path) => openIssue(options.shell, path)
    },
    extensions,
    appState: {
      read: async () => {
        await (savedTabsChecked ??= dropUnresumableTabs().catch(() => undefined))
        return appState.read()
      },
      write: writeAppState
    },
    sessions: {
      list: () => sessions.list(),
      listProblem: () => sessionIds.problem(),
      rename: (id, title) => tidySession(id, { title }),
      setHidden: (id, hidden) => tidySession(id, { hidden }),
      delete: async (ids) => {
        const deletions: Record<string, SessionDeletion> = {}
        try {
          for (const id of ids) {
            try {
              deletions[id] = await sessions.delete(id, options.trashItem)
            } catch {
              deletions[id] = { deleted: false, reason: 'failed' }
            }
          }
          // Forgotten, so a Session restored from the Recycle Bin comes back as Claude Code left it.
          const deleted = ids.filter((id) => deletions[id]?.deleted)
          if (deleted.length > 0) await writeAppState({ sessions: Object.fromEntries(deleted.map((id) => [id, null])) })
          return deletions
        } finally {
          // Even a delete that failed midway (a file held open) may have moved some files.
          await sessions.refresh()
        }
      }
    },
    system: {
      info: async () => ({ language, startFolder })
    },
    web: {
      openInBrowser: async (address) => {
        // Only a web page, so the interface cannot have the desktop run a program.
        if (!opensInBrowser(address)) throw new Error(`${address} is not a web page`)
        await options.shell?.openUrl(address)
      }
    },
    updates: {
      status: async () => updates.current()
    },
    elements: elements.as({ kind: 'user' }),
    claudeCode: {
      locate: locateWithChosenPath,
      choose: async () => {
        const path = await options.dialogs?.chooseClaudeExecutable()
        if (path) await writeAppState({ claudePath: path })
        return locateWithChosenPath()
      }
    },
    window: {
      minimize: async () => win?.minimize(),
      toggleMaximize: async () => win?.toggleMaximize(),
      close: requestClose,
      closeAnyway: stopSessionsAndClose,
      setUnsavedEditors: async (keys) => {
        unsavedEditors = [...keys]
      },
      isMaximized: async () => win?.isMaximized() ?? false,
      notify: async (notification) =>
        win?.notify(notification, () => events.emit('window.notificationClicked', { tag: notification.tag }))
    }
  }

  return {
    api,
    elements: (asker) => elements.as(asker),
    on: (event, listener) => events.on(event, listener),
    dispose: () => {
      elements.dispose()
      unsubscribeMaximized?.()
      unsubscribeVisibility?.()
      unsubscribeFocus?.()
      mapRefresh.dispose()
      updates.dispose()
      unsubscribeClose?.()
      sessionHost.dispose()
      sessions.dispose()
      events.clear()
    }
  }
}
