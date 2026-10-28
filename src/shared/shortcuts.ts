// The rules of a Shortcut, shared by the Shortcut form, which says what is wrong, and the app state,
// which keeps only Shortcuts that follow them.

import type { Shortcut, ShortcutCommand } from './api'

/** The longest name a Shortcut can have. */
export const SHORTCUT_NAME_MAX_LENGTH = 80

/** What the Shortcut form refuses, each with its own message. */
export type ShortcutProblem = 'name-missing' | 'address-invalid' | 'command-missing' | 'command-forbidden'

/** The schemes a Web tab shows: `localhost` is an http or https address like any other. */
const WEB_SCHEMES = ['http:', 'https:', 'file:']

/** Whether a Web tab may show this address: an absolute http, https or file one. */
export function isWebAddress(address: string): boolean {
  try {
    const url = new URL(address.trim())
    return WEB_SCHEMES.includes(url.protocol) && (url.protocol === 'file:' || url.hostname !== '')
  } catch {
    return false
  }
}

/**
 * What a typed command may not hold, as `--prefill` refuses them (a `claude` batch file goes through
 * cmd.exe, which would change them): a double quote, a percent sign, a line break.
 */
const FORBIDDEN = /["%\r\n]/

/** The command a Skill shortcut types, as it lands in Claude Code's prompt. */
export function commandText(command: ShortcutCommand): string {
  if (command.mode === 'free') return command.text.trim()
  const args = command.args.trim()
  return `/${command.skill}${args ? ` ${args}` : ''}`
}

/** What is wrong with a Shortcut, in the order the form shows it; empty when it can be kept. */
export function shortcutProblems(shortcut: Shortcut): ShortcutProblem[] {
  const problems: ShortcutProblem[] = []
  if (!shortcut.name.trim()) problems.push('name-missing')
  if (shortcut.kind === 'web') {
    if (!isWebAddress(shortcut.address)) problems.push('address-invalid')
    return problems
  }
  const { command } = shortcut
  const parts = command.mode === 'skill' ? [command.skill, command.args] : [command.text]
  const missing = command.mode === 'skill' ? !/^[^\s/]\S*$/.test(command.skill.trim()) : !command.text.trim()
  if (missing) problems.push('command-missing')
  else if (parts.some((part) => FORBIDDEN.test(part))) problems.push('command-forbidden')
  return problems
}

/** The Shortcut as the app state keeps it: trimmed, its name cut to length, nothing else on it. */
export function tidyShortcut(shortcut: Shortcut): Shortcut {
  const base = { id: shortcut.id, name: shortcut.name.trim().slice(0, SHORTCUT_NAME_MAX_LENGTH) }
  if (shortcut.kind === 'web') return { ...base, kind: 'web', address: shortcut.address.trim() }
  const { command } = shortcut
  return {
    ...base,
    kind: 'skill',
    command:
      command.mode === 'skill'
        ? { mode: 'skill', skill: command.skill.trim(), args: command.args.trim() }
        : { mode: 'free', text: command.text.trim() }
  }
}
