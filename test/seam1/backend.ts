import { createBackend, type Backend, type DesktopShell, type Dialogs, type WindowHost } from '../../src/backend'
import type { FakeEnvironment } from '../fake-env'

/**
 * Starts ClaudeForge's backend on a fake environment, as the main process does.
 * The given dialogs answer as if the user picked something; the others are cancelled.
 */
export function startBackend(
  env: FakeEnvironment,
  window?: WindowHost,
  dialogs?: Partial<Dialogs>,
  shell?: DesktopShell
): Backend {
  return createBackend({
    stateDir: env.userDataDir,
    claudeHome: env.claudeHome,
    systemLanguages: env.systemLanguages,
    env: env.processEnv,
    window,
    dialogs: {
      chooseClaudeExecutable: async () => undefined,
      chooseProjectFolder: async () => undefined,
      ...dialogs
    },
    trashItem: env.trashItem,
    shell
  })
}
