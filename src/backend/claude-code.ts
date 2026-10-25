import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { delimiter, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { MINIMUM_CLAUDE_CODE_VERSION, type ClaudeCodeStatus } from '../shared/api'

const run = promisify(execFile)

/** How long `claude --version` may take before ClaudeForge gives up on it. */
const VERSION_TIMEOUT_MS = 15_000

export type Environment = Record<string, string | undefined>

/** Reads an environment variable the way Windows does, whatever its case. */
export function envVar(env: Environment, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

interface Place {
  /** How the first-run screen names it. */
  label: string
  /** Every file that would be `claude` there, in the order Windows would pick them. */
  files: string[]
}

/**
 * Where `claude` is looked for: the path the user chose, PATH, then the folders
 * the native installer and npm put it in, which a ClaudeForge started before
 * the install cannot see on its PATH yet.
 */
function places(env: Environment, userPath: string | null): Place[] {
  const extensions = (envVar(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const inDirs = (dirs: string[]): string[] =>
    dirs.flatMap((dir) => extensions.map((extension) => join(dir, `claude${extension.toLowerCase()}`)))
  const under = (variable: string, ...segments: string[]): string[] => {
    const base = envVar(env, variable)
    return base ? [join(base, ...segments)] : []
  }
  return [
    ...(userPath ? [{ label: userPath, files: [userPath] }] : []),
    { label: 'PATH', files: inDirs((envVar(env, 'PATH') ?? '').split(delimiter).filter(Boolean)) },
    { label: '%USERPROFILE%\\.local\\bin', files: inDirs(under('USERPROFILE', '.local', 'bin')) },
    { label: '%APPDATA%\\npm', files: inDirs(under('APPDATA', 'npm')) }
  ]
}

/** Runs `claude --version` and returns the version it reports, or nothing when it cannot. */
async function readVersion(path: string, env: Environment): Promise<string | undefined> {
  // Batch files (an npm install's claude.cmd) only run through cmd.exe, as one quoted command line.
  const batch = /^\.(cmd|bat)$/i.test(extname(path))
  const options = { env, timeout: VERSION_TIMEOUT_MS, windowsHide: true }
  try {
    const { stdout } = batch
      ? await run(`"${path}" --version`, { ...options, shell: true })
      : await run(path, ['--version'], options)
    return /\b\d+\.\d+\.\d+\b/.exec(stdout)?.[0]
  } catch {
    return undefined
  }
}

/** Compares two `major.minor.patch` versions; negative when a is older. */
function compareVersions(a: string, b: string): number {
  const [pa, pb] = [a, b].map((version) => version.split('.').map(Number))
  for (let i = 0; i < 3; i++) {
    const diff = pa![i]! - pb![i]!
    if (diff !== 0) return diff
  }
  return 0
}

export interface LocateOptions {
  /** The environment `claude` is looked up and run in (PATH, PATHEXT, USERPROFILE, APPDATA). */
  env: Environment
  /** The `claude` the user chose, when they did; it comes first. */
  userPath: string | null
}

/** The Claude Code locator: finds the first `claude` that answers its version, and checks it is recent enough. */
export async function locateClaudeCode({ env, userPath }: LocateOptions): Promise<ClaudeCodeStatus> {
  const searched = places(env, userPath)
  for (const path of searched.flatMap(({ files }) => files)) {
    if (!(await isFile(path))) continue
    const version = await readVersion(path, env)
    if (!version) continue
    if (compareVersions(version, MINIMUM_CLAUDE_CODE_VERSION) < 0) {
      return { state: 'outdated', path, version, minimumVersion: MINIMUM_CLAUDE_CODE_VERSION }
    }
    return { state: 'found', path, version }
  }
  return { state: 'missing', lookedIn: searched.map(({ label }) => label) }
}
