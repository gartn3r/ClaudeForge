// The Extension service: what extends a Session in a Project. Skills and subagents are files in
// the user's and the Project's `.claude/` folders and in enabled plugins; MCP servers and plugins
// come from Claude Code's CLI, whose config files are internal (ADR 0003).

import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type {
  AvailablePluginListing,
  ClaudeScope,
  Extension,
  ExtensionChange,
  ExtensionChangeResult,
  ExtensionKind,
  ExtensionListing,
  ExtensionScope,
  McpServerStatus
} from '../shared/api'
import { runClaude, type Environment } from './claude-code'

/** How long `claude mcp list` may take: it starts and health-checks every server. */
const MCP_LIST_TIMEOUT_MS = 120_000
const PLUGIN_LIST_TIMEOUT_MS = 30_000
/** How long a change may take: installing a plugin downloads it. */
const CHANGE_TIMEOUT_MS = 300_000

export interface ExtensionServiceOptions {
  /** The Claude Code home, holding the user's own skills and subagents. */
  claudeHome: string
  /** The environment `claude` runs in. */
  env: Environment
  /** The `claude` to ask; rejects when there is none that can run. */
  claudePath(): Promise<string>
  /** A folder of ClaudeForge's own that is no Project, where `claude` sees only the user's Extensions. */
  noProjectFolder: string
  /** The Hosted sessions whose `claude` runs, and the folder it runs in. */
  hostedSessions(): Array<{ id: string; project: string }>
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

/** How Claude Code names the MCP servers the user's claude.ai account brings. */
const CONNECTOR = /^claude\.ai /

function mcpStatus(detail: string): McpServerStatus {
  if (/needs authentication/i.test(detail)) return 'needs-sign-in'
  if (/pending approval/i.test(detail)) return 'pending-approval'
  if (/disabled|rejected|not configured/i.test(detail)) return 'disabled'
  // Includes "Connected · tools fetch failed": connected, yet bringing no tools.
  if (/fail|error/i.test(detail)) return 'failed'
  return detail === 'Connected' ? 'connected' : 'unknown'
}

/** The fields of a `claude plugin list --json` entry ClaudeForge reads. */
interface PluginEntry {
  /** `<plugin>@<marketplace>`. */
  id: string
  scope?: ClaudeScope
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

/** Where Claude Code keeps what ClaudeForge adds at a scope: for the Project, the user's own there. */
const CLAUDE_SCOPE: Record<ExtensionScope, ClaudeScope> = { global: 'user', project: 'local' }

/**
 * The arguments of the `claude` commands that make a change, each tried in turn while Claude Code
 * finds nothing to remove.
 */
function commandsFor(change: ExtensionChange): string[][] {
  switch (change.action) {
    case 'enable-plugin':
    case 'disable-plugin':
    case 'uninstall-plugin':
      return [['plugin', change.action.replace('-plugin', ''), change.plugin.id, '-s', change.plugin.scope]]
    case 'install-plugin':
      return [['plugin', 'install', change.plugin, '-s', CLAUDE_SCOPE[change.scope]]]
    case 'add-mcp-server': {
      const { name, transport, target, args, env, headers } = change.server
      const add = ['mcp', 'add', '-s', CLAUDE_SCOPE[change.scope], '-t', transport, name]
      // `-e` and `-H` take values up to the next option, so they follow the name, and `--` ends them.
      return [
        transport === 'stdio'
          ? [...add, ...env.flatMap((variable) => ['-e', variable]), '--', target, ...args]
          : [...add, target, ...headers.flatMap((header) => ['-H', header])]
      ]
    }
    case 'remove-mcp-server':
      // `claude mcp list` does not say whether the Project's server is the user's own or shared.
      return (change.scope === 'global' ? ['user'] : ['local', 'project']).map((scope) => [
        'mcp',
        'remove',
        change.name,
        '-s',
        scope
      ])
  }
}

/** The scope a change applies to. */
const scopeOf = (change: ExtensionChange): ExtensionScope =>
  'scope' in change ? change.scope : change.plugin.scope === 'user' ? 'global' : 'project'

/** Claude Code found nothing of that name to remove at the scope it was told. */
const NOTHING_TO_REMOVE = /^No MCP server named/

/** The fields of a `claude plugin list --available --json` marketplace entry ClaudeForge reads. */
interface MarketplaceEntry {
  pluginId: string
  name: string
  description?: string
  marketplaceName: string
  installCount?: number
}

/** What Claude Code said when a command failed, else how it failed. */
function claudeError(error: unknown): string {
  const { stderr, stdout, killed, message } = error as { stderr?: string; stdout?: string; killed?: boolean; message?: string }
  if (killed) return 'Claude Code did not answer in time.'
  return stderr?.trim() || stdout?.trim() || message || String(error)
}

const KIND_ORDER: ExtensionKind[] =['skill', 'subagent', 'mcp-server', 'plugin']

const byKindThenName = (a: Extension, b: Extension): number =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
  a.name.localeCompare(b.name, 'en')

export function createExtensionService({
  claudeHome,
  env,
  claudePath,
  noProjectFolder,
  hostedSessions
}: ExtensionServiceOptions) {
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
        mcp: { status: mcpStatus(detail), detail },
        removable: !plugin && !CONNECTOR.test(name)
      }
    })
  }

  const pluginList = async (project: string, ...more: string[]): Promise<unknown> =>
    JSON.parse(
      await runClaude(await claudePath(), ['plugin', 'list', '--json', ...more], {
        env,
        cwd: project,
        timeout: PLUGIN_LIST_TIMEOUT_MS
      })
    )

  /** The plugins installed for the user or for the Project, leaving out those of other Projects. */
  const installedHere = (entries: PluginEntry[], project: string): PluginEntry[] =>
    entries.filter(({ projectPath }) => !projectPath || pathKey(projectPath) === pathKey(project))

  /**
   * The plugins installed for the user or for the Project, with the skills and subagents of those
   * enabled there; plugins installed for other Projects are left out.
   */
  const plugins = async (project: string): Promise<Extension[]> => {
    const installed = installedHere((await pluginList(project)) as PluginEntry[], project)
    const listed = await Promise.all(
      installed.map(async ({ id, enabled, installPath, projectPath, ...entry }): Promise<Extension[]> => {
        const name = id.replace(/@[^@]*$/, '')
        const scope = projectPath ? 'project' : 'global'
        const install = { id, scope: entry.scope ?? (projectPath ? 'project' : 'user') }
        const manifest = await readManifest(installPath)
        const plugin: Extension = {
          kind: 'plugin',
          name,
          scope,
          plugin: null,
          description: manifest.description,
          enabled,
          install
        }
        return [plugin, ...(enabled ? await skillsAndSubagentsIn(installPath, { scope, plugin: name }, manifest) : [])]
      })
    )
    return listed.flat()
  }

  /** The Hosted sessions that started before a change ClaudeForge made to their Extensions. */
  const outdated = new Set<string>()
  const outdatedSessions = (): string[] => {
    const running = hostedSessions().map(({ id }) => id)
    for (const id of outdated) if (!running.includes(id)) outdated.delete(id)
    return running.filter((id) => outdated.has(id))
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
      return { extensions, ...(failed ? { problem: 'claude-failed' as const } : {}), outdatedSessions: outdatedSessions() }
    },

    async available(project: string): Promise<AvailablePluginListing> {
      try {
        const listing = (await pluginList(project, '--available')) as { installed: PluginEntry[]; available: MarketplaceEntry[] }
        const installed = new Set(installedHere(listing.installed, project).map(({ id }) => id))
        const plugins = listing.available
          .filter(({ pluginId }) => !installed.has(pluginId))
          .sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0) || a.name.localeCompare(b.name, 'en'))
          .map(({ pluginId, name, description, marketplaceName }) => ({
            id: pluginId,
            name,
            description: description || null,
            marketplace: marketplaceName
          }))
        return { plugins }
      } catch {
        return { plugins: [], problem: 'claude-failed' }
      }
    },

    async change(project: string, change: ExtensionChange): Promise<ExtensionChangeResult> {
      // Claude Code reads its setup when it starts, so only those already running miss the change.
      const running = hostedSessions().filter(
        (session) => scopeOf(change) === 'global' || pathKey(session.project) === pathKey(project)
      )
      let error = ''
      for (const args of commandsFor(change)) {
        try {
          await runClaude(await claudePath(), args, { env, cwd: project, timeout: CHANGE_TIMEOUT_MS })
          for (const { id } of running) outdated.add(id)
          return { ok: true }
        } catch (failure) {
          error = claudeError(failure)
          if (!NOTHING_TO_REMOVE.test(error)) break
        }
      }
      return { ok: false, error }
    }
  }
}
