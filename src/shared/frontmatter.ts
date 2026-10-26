// The YAML frontmatter Claude Code reads a skill or subagent by. The editor checks it as the user
// types, and the backend again before it writes the file.

import { isMap, parseDocument } from 'yaml'
import type { ExtensionFileKind, FrontmatterProblem } from './api'

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NAME_MAX = 64
/** Claude Code cuts a skill's description at this length. */
const SKILL_DESCRIPTION_MAX = 1024

/** Whether Claude Code takes this as a skill's or subagent's name. */
export const isExtensionName = (name: string): boolean => NAME.test(name) && name.length <= NAME_MAX

/** The frontmatter's lines, between the `---` line opening the file and the next one; null when there is none. */
function frontmatterBlock(text: string): string | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  if (lines[0]?.trimEnd() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---')
  return end < 0 ? null : lines.slice(1, end).join('\n')
}

/** A required text field's problem, if any: missing or blank, not text, or longer than `max`. */
function textProblem(fields: Record<string, unknown>, field: string, max?: number): FrontmatterProblem | null {
  const value = fields[field]
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { code: 'missing', field }
  }
  if (typeof value !== 'string') return { code: 'not-text', field }
  if (max !== undefined && value.length > max) return { code: 'too-long', field, max }
  return null
}

/** Every problem with a skill's or subagent's frontmatter, the first YAML error alone; none when Claude Code can read it. */
export function frontmatterProblems(kind: ExtensionFileKind, text: string): FrontmatterProblem[] {
  const block = frontmatterBlock(text)
  if (block === null) return [{ code: 'no-frontmatter' }]
  const document = parseDocument(block)
  const [error] = document.errors
  if (error) {
    return [
      {
        code: 'not-yaml',
        // The block starts on the file's second line.
        line: (error.linePos?.[0].line ?? 1) + 1,
        detail: error.message.split('\n')[0]!.replace(/ at line \d+, column \d+:?$/, '')
      }
    ]
  }
  if (document.contents !== null && !isMap(document.contents)) return [{ code: 'not-fields' }]
  const fields = (document.toJS() ?? {}) as Record<string, unknown>

  const problems: FrontmatterProblem[] = []
  const name = textProblem(fields, 'name', NAME_MAX)
  if (name?.code === 'too-long' || (!name && !NAME.test(fields.name as string))) problems.push({ code: 'bad-name' })
  else if (name) problems.push(name)
  const description = textProblem(fields, 'description', kind === 'skill' ? SKILL_DESCRIPTION_MAX : undefined)
  if (description) problems.push(description)
  return problems
}
