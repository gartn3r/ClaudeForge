// The backend: every service of the typed backend API, in plain Node with no
// Electron import, so Seam 1 tests drive it directly. The main process wires
// it to IPC (see src/main/ipc.ts).

import type { AppState, AppStatePatch, BackendApi, ClaudeCodeStatus, EventName } from '../shared/api'
import { AppStateStore } from './app-state'
import { locateClaudeCode, type Environment } from './claude-code'
import { BackendEventEmitter, type Listener } from './events'
import { resolveLanguage } from './language'
import { createMapService } from './maps'
import { SessionCatalog } from './session-catalog'

/** The window the interface runs in, as the backend sees it. */
export interface WindowHost {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): boolean
  /** Calls back whenever the window is maximized or restored; returns an unsubscribe. */
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
}

export interface BackendOptions {
  /** ClaudeForge's own data folder, where app state is kept. */
  stateDir: string
  /** The Claude Code home (`CLAUDE_CONFIG_DIR`, else `~/.claude`), whose Sessions the catalog lists. */
  claudeHome: string
  /** Windows display languages in order of preference, e.g. `['fr-FR', 'en-US']`. */
  systemLanguages: readonly string[]
  /** The environment `claude` is looked up and run in. */
  env: Environment
  /** The folder ClaudeForge was started in; defaults to the current directory. */
  startFolder?: string
  /** Absent when no window exists (Seam 1 tests); window calls then do nothing. */
  window?: WindowHost
  /** Native dialogs; absent in Seam 1 tests unless one stands in for the user. */
  dialogs?: Dialogs
}

/** The native dialogs the backend asks the user through. */
export interface Dialogs {
  /** Asks for the `claude` executable; undefined when the user cancels. */
  chooseClaudeExecutable(): Promise<string | undefined>
}

export interface Backend {
  api: BackendApi
  on<E extends EventName>(event: E, listener: Listener<E>): () => void
  dispose(): void
}

export function createBackend(options: BackendOptions): Backend {
  const events = new BackendEventEmitter()
  const appState = new AppStateStore(options.stateDir)
  const sessions = new SessionCatalog(options.claudeHome, (projects) => events.emit('sessions.changed', projects))
  const language = resolveLanguage(options.systemLanguages)
  const startFolder = options.startFolder ?? process.cwd()
  const win = options.window

  const unsubscribeWindow = win?.onMaximizedChange((maximized) =>
    events.emit('window.maximizedChanged', { maximized })
  )

  const locateWithChosenPath = async (): Promise<ClaudeCodeStatus> =>
    locateClaudeCode({ env: options.env, userPath: (await appState.read()).claudePath })

  const writeAppState = async (patch: AppStatePatch): Promise<AppState> => {
    const state = await appState.write(patch)
    events.emit('appState.changed', state)
    return state
  }

  const api: BackendApi = {
    map: createMapService(),
    appState: {
      read: () => appState.read(),
      write: writeAppState
    },
    sessions: {
      list: () => sessions.list()
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
      isMaximized: async () => win?.isMaximized() ?? false
    }
  }

  return {
    api,
    on: (event, listener) => events.on(event, listener),
    dispose: () => {
      unsubscribeWindow?.()
      sessions.dispose()
      events.clear()
    }
  }
}
