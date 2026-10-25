import { createBackend, type Backend, type Dialogs, type WindowHost } from '../../src/backend'
import type { FakeEnvironment } from '../fake-env'

/** Starts ClaudeForge's backend on a fake environment, as the main process does. */
export function startBackend(env: FakeEnvironment, window?: WindowHost, dialogs?: Dialogs): Backend {
  return createBackend({
    stateDir: env.userDataDir,
    claudeHome: env.claudeHome,
    systemLanguages: env.systemLanguages,
    env: env.processEnv,
    window,
    dialogs
  })
}
