import { createBackend, type Backend, type WindowHost } from '../../src/backend'
import type { FakeEnvironment } from '../fake-env'

/** Starts ClaudeForge's backend on a fake environment, as the main process does. */
export function startBackend(env: FakeEnvironment, window?: WindowHost): Backend {
  return createBackend({
    stateDir: env.userDataDir,
    claudeHome: env.claudeHome,
    systemLanguages: env.systemLanguages,
    window
  })
}
