// Runs the user's Azure CLI, signed in with their own `az login` (ADR 0008). ClaudeForge only ever
// reads the backlog through it.

import { execFile } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { BacklogProblem } from '../../shared/api'
import { batchCommandLine, findOnPath, isFile, type Environment } from '../claude-code'

const run = promisify(execFile)

const AZ_TIMEOUT_MS = 60_000

const MAX_OUTPUT = 64 * 1024 * 1024

/**
 * Settings `az` reads from its environment: never offer to install a missing extension (it would wait
 * for a "Y" on its input), and print nothing but errors besides the JSON.
 */
const AZ_SETTINGS = {
  AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no',
  AZURE_CORE_ONLY_SHOW_ERRORS: 'true',
  AZURE_CORE_NO_COLOR: 'true'
}

/** An `az` call that failed, with why in terms the Work items card can explain. */
export class AzError extends Error {
  constructor(
    readonly problem: BacklogProblem,
    message: string
  ) {
    super(message)
  }
}

/** Runs `az` with these arguments; resolves with what it printed, read as UTF-8, rejects with an AzError. */
export type Az = (args: string[]) => Promise<string>

/** How to run `az`: a program, its first arguments and the variables it needs, or a batch file cmd.exe runs. */
export type AzCommand = { kind: 'program'; file: string; args: string[]; env: Record<string, string> } | { kind: 'batch'; file: string }

/**
 * How to run the `az` found at a path. The Windows installer's `wbin\az.cmd` runs its own Python
 * isolated (`-I`), which ignores every `PYTHON*` variable and prints in the ANSI code page, garbling
 * accented titles; ClaudeForge runs that Python itself, in UTF-8 mode (`-X utf8`), without cmd.exe.
 * Any other `az` runs as it is.
 */
export async function azCommand(path: string): Promise<AzCommand> {
  const python = join(dirname(path), '..', 'python.exe')
  if (/^\.(cmd|bat)$/i.test(extname(path)) && (await isFile(python))) {
    // As az.cmd sets it, so az knows how it was installed.
    return { kind: 'program', file: python, args: ['-X', 'utf8', '-IBm', 'azure.cli'], env: { AZ_INSTALLER: 'MSI' } }
  }
  return /^\.(cmd|bat)$/i.test(extname(path)) ? { kind: 'batch', file: path } : { kind: 'program', file: path, args: [], env: {} }
}

/** What `az` says when it lacks the `azure-devops` extension, or when no one signed in. */
const EXTENSION_MISSING = /misspelled or not recognized by the system|requires the extension azure-devops/i
const SIGNED_OUT = /az login|az devops login|login command|please run 'az login'/i

/** Why an `az` call failed, from what it printed on its error output. */
export function azProblem(stderr: string): BacklogProblem {
  if (EXTENSION_MISSING.test(stderr)) return 'extension-missing'
  if (SIGNED_OUT.test(stderr)) return 'signed-out'
  return 'az-failed'
}

export function createAz(env: Environment): Az {
  return async (args) => {
    const path = await findOnPath(env, 'az')
    if (!path) throw new AzError('az-missing', 'The Azure CLI is not on PATH')
    const command = await azCommand(path)
    const options = {
      env: { ...env, ...AZ_SETTINGS, PYTHONUTF8: '1' },
      timeout: AZ_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      encoding: 'utf8' as const
    }
    try {
      const { stdout } =
        command.kind === 'batch'
          ? await run(batchCommandLine(command.file, args), { ...options, shell: true })
          : await run(command.file, [...command.args, ...args], { ...options, env: { ...options.env, ...command.env } })
      return stdout
    } catch (error) {
      const { code, stderr } = error as { code?: number | string; stderr?: string }
      if (code === 'ENOENT') throw new AzError('az-missing', String(error))
      const message = stderr?.replace(/^ERROR:\s*/, '').trim() || String(error)
      throw new AzError(azProblem(message), message)
    }
  }
}
