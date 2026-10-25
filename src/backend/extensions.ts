// The Extension service: what extends a Session in a Project. Skills and subagents are files in
// the user's and the Project's `.claude/` folders and in enabled plugins; MCP servers and plugins
// come from Claude Code's CLI, whose config files are internal (ADR 0003).

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Extension, ExtensionKind, ExtensionListing, ExtensionScope, McpServerStatus } from '../shared/api'
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

async function entries(folder: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The skills of one `skills/` folder: a folder each, named by its SKILL.md. */
async function skillsIn(folder: string, scope: ExtensionScope, plugin: string | null): Promise<Extension[]> {
  const skills: Extension[] = []
  for (const entry of await entries(folder)) {
    if (!entry.isDirectory()) continue
    let text: string
    try {
      text = await readFile(join(folder, entry.name, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const { name, description } = frontmatter(text)
    skills.push({ kind: 'skill', name: name || entry.name, scope, plugin, description: description || null })
  }
  return skills
}

/** The subagents of one `agents/` folder: a Markdown file each. */
async function subagentsIn(folder: string, scope: ExtensionScope, plugin: string | null): Promise<Extension[]> {
  const subagents: Extension[] = []
  for (const entry of await entries(folder)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const { name, description } = frontmatter(await readFile(join(folder, entry.name), 'utf8'))
    const stem = entry.name.slice(0, -'.md'.length)
    subagents.push({ kind: 'subagent', name: name || stem, scope, plugin, description: description || null })
  }
  return subagents
}

/** The skills and subagents of a folder laid out like `.claude/`. */
async function filesIn(folder: string, scope: ExtensionScope, plugin: string | null): Promise<Extension[]> {
  const [skills, subagents] = await Promise.all([
    skillsIn(join(folder, 'skills'), scope, plugin),
    subagentsIn(join(folder, 'agents'), scope, plugin)
  ])
  return [...skills, ...subagents]
}

interface McpServerLine {
  /** As Claude Code names it: `plugin:<plugin>:<server>` for a plugin's server. */
  name: string
  /** The words after the status glyph, e.g. "Failed to connect". */
  detail: string
}

/** Reads `claude mcp list`'s output: one `<name>: <command or URL> - <glyph> <status>` line per server. */
function parseMcpList(output: string): McpServerLine[] {
  const servers: McpServerLine[] = []
  for (const line of output.split(/\r?\n/)) {
    const server = /^(.+?): .* - \S (.+)$/u.exec(line.trim())
    if (server) servers.push({ name: server[1]!, detail: server[2]! })
  }
  return servers
}

function mcpStatus(detail: string): McpServerStatus {
  if (/needs authentication/i.test(detail)) return 'needs-sign-in'
  if (/pending approval/i.test(detail)) return 'pending-approval'
  if (/disabled|rejected|not configured/i.test(detail)) return 'disabled'
  // "Connected · tools fetch failed" is connected, yet brings no tools.
  return detail === 'Connected' ? 'connected' : 'failed'
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

/** Windows paths compare without regard to case. */
const pathKey = (path: string): string => {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** The description in a plugin's manifest, if it has one. */
async function pluginDescription(installPath: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8')) as {
      description?: unknown
    }
    return typeof manifest.description === 'string' ? manifest.description : null
  } catch {
    return null
  }
}

const KIND_ORDER: ExtensionKind[] =['skill', 'subagent', 'mcp-server', 'plugin']

const byKindThenName = (a: Extension, b: Extension): number =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
  a.name.localeCompare(b.name, 'en')

export function createExtensionService({ claudeHome, env, claudePath, noProjectFolder }: ExtensionServiceOptions) {
  const mcpList = async (cwd: string): Promise<McpServerLine[]> =>
    parseMcpList(await runClaude(await claudePath(), ['mcp', 'list'], { env, cwd, timeout: MCP_LIST_TIMEOUT_MS }))

  /**
   * The MCP servers a Session in the Project gets. `claude mcp list` does not say where a server
   * is configured, so the servers it also lists outside any Project are the user's (global) ones.
   */
  const mcpServers = async (project: string): Promise<Extension[]> => {
    await mkdir(noProjectFolder, { recursive: true })
    const [inProject, outside] = await Promise.all([mcpList(project), mcpList(noProjectFolder)])
    const global = new Set(outside.map(({ name }) => name))
    return inProject.map(({ name, detail }) => {
      const [, plugin, server] = /^plugin:([^:]+):(.+)$/.exec(name) ?? []
      return {
        kind: 'mcp-server',
        name: server ?? name,
        scope: global.has(name) ? 'global' : 'project',
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
        const scope: ExtensionScope = projectPath ? 'project' : 'global'
        const plugin: Extension = {
          kind: 'plugin',
          name,
          scope,
          plugin: null,
          description: await pluginDescription(installPath),
          enabled
        }
        return [plugin, ...(enabled ? await filesIn(installPath, scope, name) : [])]
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
          filesIn(claudeHome, 'global', null),
          filesIn(join(project, '.claude'), 'project', null),
          fromClaude(mcpServers(project)),
          fromClaude(plugins(project))
        ])
      ).flat()
      extensions.sort(byKindThenName)
      return failed ? { extensions, problem: 'claude-failed' } : { extensions }
    }
  }
}
