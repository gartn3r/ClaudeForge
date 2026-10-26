// The YAML frontmatter Claude Code reads a skill or subagent by, checked by the rules Claude Code's
// documentation gives: the editor checks it as the user types, and the backend again before it writes.

import { isMap, parseDocument } from 'yaml'
import type { ExtensionFileKind, FrontmatterProblem } from './api'

/** How ClaudeForge names what it creates: lowercase letters, numbers and hyphens, which name the file too. */
const NEW_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NEW_NAME_MAX = 64
const BYTE_ORDER_MARK = 0xfeff

/**
 * What Claude Code refuses in a skill's name: control, invisible, private-use, unassigned and
 * direction characters, angle brackets, and any blank but one plain space between words.
 */
const SKILL_NAME_REFUSED = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}<>]|[^\S ]| {2}|^ | $/u
/** Claude Code skips a subagent whose name starts with "-", holds ":" (plugin names) or is longer. */
const SUBAGENT_NAME_REFUSED = /^-|:/
const SUBAGENT_NAME_MAX = 256

/** Whether ClaudeForge creates a skill or subagent of this name. */
export const isExtensionName = (name: string): boolean => NEW_NAME.test(name) && name.length <= NEW_NAME_MAX

type Fields = Record<string, unknown>

/**
 * The frontmatter's fields: none when the file opens without a `---` line, 'unclosed' when no
 * second one ends them, else the YAML between the two.
 */
function frontmatterBlock(text: string): string | 'unclosed' | null {
  // A file saved with a byte order mark still opens with its `---` line.
  const lines = (text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text).split(/\r?\n/)
  if (lines[0]?.trimEnd() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---')
  return end < 0 ? 'unclosed' : lines.slice(1, end).join('\n')
}

/** The frontmatter's fields, as far as they can be read; empty when they cannot. */
export function frontmatterFields(text: string): Fields {
  const block = frontmatterBlock(text)
  if (block === null || block === 'unclosed') return {}
  const document = parseDocument(block)
  return !document.errors.length && isMap(document.contents) ? (document.toJS() as Fields) : {}
}

const blank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

/** A field's problem: missing when required, not text, or refused by `check`. */
function fieldProblem(
  fields: Fields,
  field: 'name' | 'description',
  { required, check }: { required: boolean; check?: (value: string) => FrontmatterProblem | null }
): FrontmatterProblem | null {
  const value = fields[field]
  if (blank(value)) return required ? { code: 'missing', field } : null
  if (typeof value !== 'string') return { code: 'not-text', field }
  return check?.(value) ?? null
}

function subagentNameProblem(name: string): FrontmatterProblem | null {
  if (SUBAGENT_NAME_REFUSED.test(name)) return { code: 'bad-name' }
  if (name.length > SUBAGENT_NAME_MAX) return { code: 'too-long', field: 'name', max: SUBAGENT_NAME_MAX }
  return null
}

/** Every problem that would keep Claude Code from reading the file as meant, the first YAML error alone. */
export function frontmatterProblems(kind: ExtensionFileKind, text: string): FrontmatterProblem[] {
  const block = frontmatterBlock(text)
  if (block === 'unclosed') return [{ code: 'unclosed-frontmatter' }]
  // A skill needs no frontmatter: Claude Code names it by its folder.
  if (block === null) return kind === 'skill' ? [] : [{ code: 'no-frontmatter' }]
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
  const fields = (document.toJS() ?? {}) as Fields

  const problems =
    kind === 'skill'
      ? [
          fieldProblem(fields, 'name', {
            required: false,
            check: (name) => (SKILL_NAME_REFUSED.test(name) ? { code: 'bad-name' } : null)
          }),
          fieldProblem(fields, 'description', { required: false })
        ]
      : [
          fieldProblem(fields, 'name', { required: true, check: subagentNameProblem }),
          fieldProblem(fields, 'description', { required: true })
        ]
  return problems.filter((problem) => problem !== null)
}
