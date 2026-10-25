// Runs the user's GitHub CLI. ClaudeForge only ever reads through it (ADR 0002).

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { delimiter, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { TrackerProblem } from '../../shared/api'
import { envVar, type Environment } from '../claude-code'

const run = promisify(execFile)

const GH_TIMEOUT_MS = 30_000

/** Issue lists carry every body; far more than execFile's default buffer. */
const MAX_OUTPUT = 64 * 1024 * 1024

/** `gh` exits with 4 when it needs the user to sign in. */
const AUTH_REQUIRED = 4

/** A `gh` call that failed, with why in terms the Map panel can explain. */
export class GhError extends Error {
  constructor(
    readonly problem: TrackerProblem,
    message: string
  ) {
    super(message)
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** The first `gh` on PATH, in the order Windows would pick it. */
async function findGh(env: Environment): Promise<string | undefined> {
  const extensions = (envVar(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of (envVar(env, 'PATH') ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const path = join(dir, `gh${extension.toLowerCase()}`)
      if (await isFile(path)) return path
    }
  }
  return undefined
}

/** Runs `gh` in a folder; resolves with its standard output, rejects with a GhError. */
export type Gh = (args: string[], cwd: string) => Promise<string>

export function createGh(env: Environment): Gh {
  return async (args, cwd) => {
    // Looked up on every call, so installing gh needs no restart.
    const path = await findGh(env)
    if (!path) throw new GhError('gh-missing', 'The GitHub CLI is not on PATH')
    const options = { cwd, env, timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true }
    try {
      // Batch files only run through cmd.exe, as one command line; ClaudeForge's arguments hold no quotes.
      const { stdout } = /^\.(cmd|bat)$/i.test(extname(path))
        ? await run(`"${path}" ${args.map((arg) => `"${arg}"`).join(' ')}`, { ...options, shell: true })
        : await run(path, args, options)
      return stdout
    } catch (error) {
      const { code, stderr } = error as { code?: number | string; stderr?: string }
      const message = stderr?.trim() || String(error)
      if (code === 'ENOENT') throw new GhError('gh-missing', message)
      if (code === AUTH_REQUIRED || /gh auth login/.test(message)) throw new GhError('gh-signed-out', message)
      throw new GhError('gh-failed', message)
    }
  }
}
