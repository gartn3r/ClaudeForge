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
  TerminalSize,
  WindowNotification
} from '../shared/api'
import { AppStateStore } from './app-state'
import { locateClaudeCode, type Environment } from './claude-code'
import { BackendEventEmitter, type Listener } from './events'
import { createExtensionService } from './extensions'
import { resolveLanguage } from './language'
import { createMapService } from './maps'
import { resolveWayfinderLink } from './maps/links'
import type { TrashItem } from './recycle-bin'
import { SessionCatalog } from './session-catalog'
import { SessionHost } from './session-host'

/** The window the interface runs in, as the backend sees it. */
export interface WindowHost {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): boolean
  /** Calls back whenever the window is maximized or restored; returns an unsubscribe. */
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Shows a Windows notification; `onClick` runs once the user clicked it and the window came to the front. */
  notify(notification: WindowNotification, onClick: () => void): void
}

export interface BackendOptions {
  /** ClaudeForge's own data folder, where app state is kept. */
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
  const maps = createMapService(options.env)
  const sessions = new SessionCatalog(
    options.claudeHome,
    (projects) => events.emit('sessions.changed', projects),
    async () => (await appState.read()).sessions,
    (project, args) => resolveWayfinderLink(maps, project, args)
  )
  const language = resolveLanguage(options.systemLanguages)
  const startFolder = options.startFolder ?? process.cwd()
  const win = options.window

  const unsubscribeWindow = win?.onMaximizedChange((maximized) =>
    events.emit('window.maximizedChanged', { maximized })
  )

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
    onOutput: (id, data) => events.emit('sessionHost.output', { id, data }),
    onExit: (id, exitCode) => events.emit('sessionHost.exit', { id, exitCode }),
    onStatus: (id, status) => events.emit('sessionHost.status', { id, status }),
    onTurnEnd: (id, cwd) => events.emit('sessionHost.turnEnded', { id, cwd })
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

  /** Stores how the user tidied one Session, then pushes the catalog as it now looks. */
  const tidySession = async (id: string, preferences: NonNullable<AppStatePatch['sessions']>[string]): Promise<void> => {
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
      openIssue: (path) => openIssue(options.shell, path)
    },
    extensions,
    appState: {
      read: () => appState.read(),
      write: writeAppState
    },
    sessions: {
      list: () => sessions.list(),
      rename: (id, title) => tidySession(id, { title }),
      setHidden: (id, hidden) => tidySession(id, { hidden }),
      delete: async (id) => {
        try {
          const deletion = await sessions.delete(id, options.trashItem)
          // Forgotten, so a Session restored from the Recycle Bin comes back as Claude Code left it.
          if (deletion.deleted) await writeAppState({ sessions: { [id]: null } })
          return deletion
        } finally {
          // Even a delete that failed midway (a file held open) may have moved some files.
          await sessions.refresh()
        }
      }
    },
    system: {
      info: async () => ({ language, startFolder })
    },
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
      close: async () => win?.close(),
      isMaximized: async () => win?.isMaximized() ?? false,
      notify: async (notification) =>
        win?.notify(notification, () => events.emit('window.notificationClicked', { tag: notification.tag }))
    }
  }

  return {
    api,
    on: (event, listener) => events.on(event, listener),
    dispose: () => {
      unsubscribeWindow?.()
      sessionHost.dispose()
      sessions.dispose()
      events.clear()
    }
  }
}
