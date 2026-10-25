// The shared fake environment behind both test seams: a temporary folder
// holding a Claude Code home, fixture Projects, ClaudeForge's data folder and
// fake `claude` and `gh` executables first on PATH.

import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const FIXTURES = resolve(__dirname, '../fixtures')
const BIN_SOURCES = resolve(__dirname, 'bin')

export const FIXTURE_PROJECTS = ['harbor-api', 'recipe-box', 'dotfiles'] as const
export type FixtureProject = (typeof FIXTURE_PROJECTS)[number]

export type FakeTool = 'claude' | 'gh'

export interface Invocation {
  args: string[]
  cwd: string
  /** The CLAUDE_*, GH_, TERM_PROGRAM and FORCE_COLOR variables it saw. */
  env: Record<string, string>
}

export interface FakeEnvironmentOptions {
  /** Windows display languages ClaudeForge should see; defaults to English. */
  systemLanguages?: string[]
}

export interface FakeEnvironment {
  root: string
  /** The Claude Code home (`CLAUDE_CONFIG_DIR`). */
  claudeHome: string
  /** ClaudeForge's own data folder, where app state lives. */
  userDataDir: string
  projects: Record<FixtureProject, string>
  systemLanguages: string[]
  /** Environment for anything spawned against the fake environment, ClaudeForge included. */
  processEnv: Record<string, string>
  /** Every recorded call of a fake executable, oldest first. */
  invocations(tool: FakeTool): Promise<Invocation[]>
  dispose(): Promise<void>
}

/** Claude Code names a Project's history folder after its path, every other character a dash. */
export const encodeProjectPath = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

async function writeExecutable(binDir: string, tool: FakeTool, script: string): Promise<void> {
  const node = process.execPath
  await writeFile(join(binDir, `${tool}.cmd`), `@echo off\r\n"${node}" "${script}" %*\r\n`)
  const posix = join(binDir, tool)
  await writeFile(posix, `#!/bin/sh\nexec "${node}" "${script}" "$@"\n`)
  await chmod(posix, 0o755)
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
  await writeExecutable(binDir, 'claude', join(BIN_SOURCES, 'fake-claude.mjs'))
  await writeExecutable(binDir, 'gh', join(BIN_SOURCES, 'fake-gh.mjs'))

  const processEnv: Record<string, string> = {
    ...inheritedEnv(),
    PATH: `${binDir}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
    HOME: homeDir,
    USERPROFILE: homeDir,
    CLAUDE_CONFIG_DIR: claudeHome,
    CLAUDEFORGE_USER_DATA: userDataDir,
    CLAUDEFORGE_SYSTEM_LANGUAGES: systemLanguages.join(','),
    FAKE_ENV_LOG_DIR: logDir,
    FAKE_GH_RECORDINGS: join(FIXTURES, 'gh')
  }

  return {
    root,
    claudeHome,
    userDataDir,
    projects,
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
