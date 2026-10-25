// The Extension service: what extends a Session in a Project. Skills and subagents are files in
// the user's and the Project's `.claude/` folders and in enabled plugins; MCP servers and plugins
// come from Claude Code's CLI, whose config files are internal (ADR 0003).

import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Extension, ExtensionKind, ExtensionListing, McpServerStatus } from '../shared/api'
import { runClaude, type Environment } from './claude-code'

/** How long `claude mcp list` may take: it starts and health-checks every server. */
const MCP_LIST_TIMEOUT_MS = 120_000
const PLUGIN_LIST_TIMEOUT_MS = 30_000

export interface ExtensionServiceOptions {
  /** The Claude Code home, holding the user's own skills and subagents. */
  claudeHome: string
  /** The environment `claude` runs in. */
  env: Environment
  /** The `claude` to ask; rejects when there is none that can run. */
  claudePath(): Promise<string>
  /** A folder of ClaudeForge's own that is no Project, where `claude` sees only the user's Extensions. */
  noProjectFolder: string
}

/** Where an Extension comes from: its scope, and the plugin that brings it, if any. */
type Origin = Pick<Extension, 'scope' | 'plugin'>

/** The fields of a Markdown file's YAML frontmatter that are written on one line. */
function frontmatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*?)\s*$/.exec(line)
    if (field) fields[field[1]!] = field[2]!.replace(/^(["'])(.*)\1$/, '$2')
  }
  return fields
}

async function entries(folder: string): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true })
  } catch {
    return []
  }
}

/** A skill or subagent from its Markdown file, named by its frontmatter, else as its file or folder is; null when unreadable. */
async function fromMarkdown(kind: ExtensionKind, file: string, fallbackName: string, origin: Origin): Promise<Extension | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const { name, description } = frontmatter(text)
  return { kind, name: name || fallbackName, ...origin, description: description || null }
}

const found = (extensions: (Extension | null)[]): Extension[] => extensions.filter((extension) => extension !== null)

/** The skills of a folder of skill folders (each with its SKILL.md), or of one skill's own folder. */
async function skillsIn(folder: string, origin: Origin): Promise<Extension[]> {
  const own = await fromMarkdown('skill', join(folder, 'SKILL.md'), basename(folder), origin)
  if (own) return [own]
  const folders = (await entries(folder)).filter((entry) => entry.isDirectory())
  return found(
    await Promise.all(folders.map(({ name }) => fromMarkdown('skill', join(folder, name, 'SKILL.md'), name, origin)))
  )
}

/** The subagents of a folder of Markdown files, or of one subagent's file. */
async function subagentsIn(path: string, origin: Origin): Promise<Extension[]> {
  if (path.endsWith('.md')) return found([await fromMarkdown('subagent', path, basename(path, '.md'), origin)])
  const files = (await entries(path)).filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  return found(
    await Promise.all(files.map(({ name }) => fromMarkdown('subagent', join(path, name), basename(name, '.md'), origin)))
  )
}

/** The skills and subagents of a folder laid out like `.claude/`, and of any further folders or files given. */
async function skillsAndSubagentsIn(
  folder: string,
  origin: Origin,
  more: { skills: string[]; agents: string[] } = { skills: [], agents: [] }
): Promise<Extension[]> {
  const listed = await Promise.all([
    ...[join(folder, 'skills'), ...more.skills].map((path) => skillsIn(path, origin)),
    ...[join(folder, 'agents'), ...more.agents].map((path) => subagentsIn(path, origin))
  ])
  return listed.flat()
}

interface McpServerLine {
  /** As Claude Code names it: `plugin:<plugin>:<server>` for a plugin's server. */
  name: string
  /** The command or URL it runs. */
  target: string
  /** The words after the status glyph, e.g. "Failed to connect". */
  detail: string
}

/** Reads `claude mcp list`'s output: one `<name>: <command or URL> - <glyph> <status>` line per server. */
function parseMcpList(output: string): McpServerLine[] {
  const servers: McpServerLine[] = []
  for (const line of output.split(/\r?\n/)) {
    const server = /^(.+?): (.*) - \S+ (.+)$/u.exec(line.trim())
    if (server) servers.push({ name: server[1]!, target: server[2]!, detail: server[3]! })
  }
  return servers
}

function mcpStatus(detail: string): McpServerStatus {
  if (/needs authentication/i.test(detail)) return 'needs-sign-in'
  if (/pending approval/i.test(detail)) return 'pending-approval'
  if (/disabled|rejected|not configured/i.test(detail)) return 'disabled'
  // Includes "Connected · tools fetch failed": connected, yet bringing no tools.
  if (/fail|error/i.test(detail)) return 'failed'
  return detail === 'Connected' ? 'connected' : 'unknown'
}

/** The fields of a `claude plugin list --json` entry ClaudeForge reads. */
interface InstalledPlugin {
  /** `<plugin>@<marketplace>`. */
  id: string
  /** Whether the plugin is on where `claude` ran. */
  enabled: boolean
  installPath: string
  /** The Project it is installed for, when it is not the user's. */
  projectPath?: string
}

interface PluginManifest {
  description: string | null
  /** Folders and files of skills and subagents beyond the plugin's `skills/` and `agents/`. */
  skills: string[]
  agents: string[]
}

/**
 * Reads a plugin's `.claude-plugin/plugin.json`: the manifest its author writes, a published
 * format rather than Claude Code's own config.
 */
async function readManifest(installPath: string): Promise<PluginManifest> {
  let manifest: Record<string, unknown> = {}
  try {
    manifest = JSON.parse(await readFile(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>
  } catch {
    // A plugin without a readable manifest still has its default folders.
  }
  const paths = (value: unknown): string[] =>
    (typeof value === 'string' ? [value] : Array.isArray(value) ? value : [])
      .filter((path): path is string => typeof path === 'string')
      .map((path) => resolve(installPath, path))
  return {
    description: typeof manifest.description === 'string' ? manifest.description : null,
    skills: paths(manifest.skills),
    agents: paths(manifest.agents)
  }
}

/** Windows paths compare without regard to case. */
const pathKey = (path: string): string => {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const KIND_ORDER: ExtensionKind[] = ['skill', 'subagent', 'mcp-server', 'plugin']

const byKindThenName = (a: Extension, b: Extension): number =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
  a.name.localeCompare(b.name, 'en')

export function createExtensionService({ claudeHome, env, claudePath, noProjectFolder }: ExtensionServiceOptions) {
  const mcpList = async (cwd: string): Promise<McpServerLine[]> =>
    parseMcpList(await runClaude(await claudePath(), ['mcp', 'list'], { env, cwd, timeout: MCP_LIST_TIMEOUT_MS }))

  /**
   * The MCP servers a Session in the Project gets. `claude mcp list` does not say where a server
   * is configured, so the servers it also lists, alike, outside any Project are the user's (global)
   * ones; a Project server replacing one of the user's runs something else.
   */
  const mcpServers = async (project: string): Promise<Extension[]> => {
    await mkdir(noProjectFolder, { recursive: true })
    const [inProject, outside] = await Promise.all([mcpList(project), mcpList(noProjectFolder)])
    const global = new Set(outside.map(({ name, target }) => `${name}\n${target}`))
    return inProject.map(({ name, target, detail }) => {
      const [, plugin, server] = /^plugin:([^:]+):(.+)$/.exec(name) ?? []
      return {
        kind: 'mcp-server',
        name: server ?? name,
        scope: global.has(`${name}\n${target}`) ? 'global' : 'project',
        plugin: plugin ?? null,
        description: null,
        mcp: { status: mcpStatus(detail), detail }
      }
    })
  }

  /**
   * The plugins installed for the user or for the Project, with the skills and subagents of those
   * enabled there; plugins installed for other Projects are left out.
   */
  const plugins = async (project: string): Promise<Extension[]> => {
    const output = await runClaude(await claudePath(), ['plugin', 'list', '--json'], {
      env,
      cwd: project,
      timeout: PLUGIN_LIST_TIMEOUT_MS
    })
    const installed = (JSON.parse(output) as InstalledPlugin[]).filter(
      ({ projectPath }) => !projectPath || pathKey(projectPath) === pathKey(project)
    )
    const listed = await Promise.all(
      installed.map(async ({ id, enabled, installPath, projectPath }): Promise<Extension[]> => {
        const name = id.replace(/@[^@]*$/, '')
        const scope = projectPath ? 'project' : 'global'
        const manifest = await readManifest(installPath)
        const plugin: Extension = { kind: 'plugin', name, scope, plugin: null, description: manifest.description, enabled }
        return [plugin, ...(enabled ? await skillsAndSubagentsIn(installPath, { scope, plugin: name }, manifest) : [])]
      })
    )
    return listed.flat()
  }

  return {
    async list(project: string): Promise<ExtensionListing> {
      let failed = false
      // What Claude Code cannot tell is left out, so the files still show.
      const fromClaude = (listing: Promise<Extension[]>): Promise<Extension[]> =>
        listing.catch(() => {
          failed = true
          return []
        })
      const extensions = (
        await Promise.all([
          skillsAndSubagentsIn(claudeHome, { scope: 'global', plugin: null }),
          skillsAndSubagentsIn(join(project, '.claude'), { scope: 'project', plugin: null }),
          fromClaude(mcpServers(project)),
          fromClaude(plugins(project))
        ])
      ).flat()
      extensions.sort(byKindThenName)
      return failed ? { extensions, problem: 'claude-failed' } : { extensions }
    }
  }
}
