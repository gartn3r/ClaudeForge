import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tracker } from '../../shared/api'

const DECLARATION = join('docs', 'agents', 'issue-tracker.md')

/**
 * Reads the Project's Tracker from its issue-tracker declaration, whose title
 * names it (`# Issue tracker: Local Markdown`, `# Issue tracker: GitHub`). With
 * no declaration, Wayfinder defaults to local markdown, and so does ClaudeForge.
 */
export async function detectTracker(project: string): Promise<Tracker> {
  let text: string
  try {
    text = await readFile(join(project, DECLARATION), 'utf8')
  } catch {
    return { kind: 'local-markdown' }
  }
  const name = /^#\s*Issue tracker\s*:\s*(.+?)\s*$/im.exec(text)?.[1] ?? null
  if (/local[\s-]*markdown/i.test(name ?? text)) return { kind: 'local-markdown' }
  if (/github/i.test(name ?? text)) return { kind: 'github' }
  return { kind: 'unsupported', name }
}
