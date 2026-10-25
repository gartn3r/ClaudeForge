// The shared fake environment behind both test seams: a temporary folder
// holding a Claude Code home, fixture Projects, ClaudeForge's data folder and
// fake `claude` and `gh` executables first on PATH.

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const FIXTURES = resolve(__dirname, '../fixtures')
const BIN_SOURCES = resolve(__dirname, 'bin')

export const FIXTURE_PROJECTS = ['harbor-api', 'recipe-box', 'dotfiles'] as const
export type FixtureProject = (typeof FIXTURE_PROJECTS)[number]

export type FakeTool = 'claude' | 'gh'

/** What the fake `claude` answers to `--version` unless told otherwise. */
export const FAKE_CLAUDE_VERSION = '2.1.300'

export interface Invocation {
  args: string[]
  cwd: string
  /** The CLAUDE_*, GH_, TERM_PROGRAM and FORCE_COLOR variables it saw. */
  env: Record<string, string>
}

export interface FakeClaudeOptions {
  /** What `claude --version` reports; defaults to FAKE_CLAUDE_VERSION. */
  version?: string
  /**
   * On PATH (the default); in the native installer's folder (`%USERPROFILE%\.local\bin`), off PATH;
   * or in some other folder off PATH, as an install the user has to point at.
   */
  location?: 'path' | 'installer' | 'elsewhere'
}

export interface FakeEnvironmentOptions {
  /** Windows display languages ClaudeForge should see; defaults to English. */
  systemLanguages?: string[]
  /** The fake `claude`; `false` leaves Claude Code uninstalled. Defaults to one on PATH. */
  claude?: FakeClaudeOptions | false
}

export interface FakeEnvironment {
  root: string
  /** The Claude Code home (`CLAUDE_CONFIG_DIR`). */
  claudeHome: string
  /** ClaudeForge's own data folder, where app state lives. */
  userDataDir: string
  projects: Record<FixtureProject, string>
  /** Where the fake `claude` is, when there is one. */
  readonly claudePath: string | undefined
  systemLanguages: string[]
  /** Environment for anything spawned against the fake environment, ClaudeForge included. */
  processEnv: Record<string, string>
  /** Installs a fake `claude` (replacing any at the same place) and returns its path. */
  installClaude(options?: FakeClaudeOptions): Promise<string>
  /** Every recorded call of a fake executable, oldest first. */
  invocations(tool: FakeTool): Promise<Invocation[]>
  dispose(): Promise<void>
}

/** Claude Code names a Project's history folder after its path, every other character a dash. */
export const encodeProjectPath = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

/** A Windows shim that runs a fake executable's script with this Node, with extra variables set. */
async function writeExecutable(path: string, script: string, variables: Record<string, string> = {}): Promise<void> {
  const set = Object.entries(variables).map(([name, value]) => `set "${name}=${value}"\r\n`)
  await writeFile(path, `@echo off\r\n${set.join('')}"${process.execPath}" "${script}" %*\r\n`)
}

async function seedClaudeHome(claudeHome: string, projects: Record<FixtureProject, string>): Promise<void> {
  const source = join(FIXTURES, 'claude-home')
  await cp(source, claudeHome, { recursive: true, filter: (from) => !from.startsWith(join(source, 'sessions')) })
  for (const project of await readdir(join(source, 'sessions'))) {
    const cwd = projects[project as FixtureProject]
    if (!cwd) throw new Error(`Session fixtures for unknown Project ${project}`)
    const target = join(claudeHome, 'projects', encodeProjectPath(cwd))
    await mkdir(target, { recursive: true })
    for (const file of await readdir(join(source, 'sessions', project))) {
      const text = await readFile(join(source, 'sessions', project, file), 'utf8')
      const filled = text.replaceAll('__CWD_JSON__', JSON.stringify(cwd).slice(1, -1)).replaceAll('__CWD__', cwd)
      await writeFile(join(target, file), filled)
    }
  }
}

const holdsClaude = (dir: string): boolean =>
  ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'].some((name) => existsSync(join(dir, name)))

/** This machine's PATH without the folders of any real Claude Code, so only the fake one is found. */
function inheritedPath(): string {
  const path = process.env.PATH ?? process.env.Path ?? ''
  return path
    .split(delimiter)
    .filter((dir) => dir && !holdsClaude(dir))
    .join(delimiter)
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    // PATH is rebuilt below; Windows spells it Path.
    if (value !== undefined && key.toUpperCase() !== 'PATH') env[key] = value
  }
  return env
}

export async function createFakeEnvironment(options: FakeEnvironmentOptions = {}): Promise<FakeEnvironment> {
  const root = await mkdtemp(join(tmpdir(), 'claudeforge-test-'))
  const homeDir = join(root, 'home')
  const claudeHome = join(homeDir, '.claude')
  const userDataDir = join(root, 'claudeforge-data')
  const binDir = join(root, 'bin')
  const logDir = join(root, 'log')
  const projectsDir = join(root, 'projects')
  const systemLanguages = options.systemLanguages ?? ['en-US']

  await Promise.all([mkdir(binDir, { recursive: true }), mkdir(logDir), mkdir(userDataDir)])
  await cp(join(FIXTURES, 'projects'), projectsDir, { recursive: true })
  const projects = Object.fromEntries(
    FIXTURE_PROJECTS.map((name) => [name, join(projectsDir, name)])
  ) as Record<FixtureProject, string>
  await seedClaudeHome(claudeHome, projects)
  await writeExecutable(join(binDir, 'gh.cmd'), join(BIN_SOURCES, 'fake-gh.mjs'))

  const processEnv: Record<string, string> = {
    ...inheritedEnv(),
    PATH: `${binDir}${delimiter}${inheritedPath()}`,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: join(homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
    CLAUDE_CONFIG_DIR: claudeHome,
    CLAUDEFORGE_USER_DATA: userDataDir,
    CLAUDEFORGE_SYSTEM_LANGUAGES: systemLanguages.join(','),
    FAKE_ENV_LOG_DIR: logDir,
    FAKE_GH_RECORDINGS: join(FIXTURES, 'gh')
  }

  let claudePath: string | undefined
  const installClaude = async ({ version, location }: FakeClaudeOptions = {}): Promise<string> => {
    // Elsewhere is a folder name with a space, as under Program Files.
    const dir = { path: binDir, installer: join(homeDir, '.local', 'bin'), elsewhere: join(root, 'Claude Code') }[
      location ?? 'path'
    ]
    await mkdir(dir, { recursive: true })
    claudePath = join(dir, 'claude.cmd')
    await writeExecutable(claudePath, join(BIN_SOURCES, 'fake-claude.mjs'), {
      FAKE_CLAUDE_VERSION: version ?? FAKE_CLAUDE_VERSION
    })
    return claudePath
  }
  if (options.claude !== false) await installClaude(options.claude)

  return {
    root,
    claudeHome,
    userDataDir,
    projects,
    get claudePath() {
      return claudePath
    },
    installClaude,
    systemLanguages,
    processEnv,
    async invocations(tool) {
      let text: string
      try {
        text = await readFile(join(logDir, `${tool}.jsonl`), 'utf8')
      } catch {
        return []
      }
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Invocation)
    },
    async dispose() {
      // Windows can hold a file briefly after a process exits.
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }
}
