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
 * Whether the default browser may be handed this address: an http or https one, or a local web
 * page (`.html`, `.htm`). Windows opens any other `file` address with its own program, and would
 * run one that is a program, so none other is handed over.
 */
export function opensInBrowser(address: string): boolean {
  if (!isWebAddress(address)) return false
  const url = new URL(address.trim())
  return url.protocol !== 'file:' || /\.html?$/i.test(url.pathname)
}

/** Whether a page may have the default browser open this new window: only an http or https one. */
export const isPopupAddress = (address: string): boolean => isWebAddress(address) && /^https?:/i.test(address.trim())

/** Where a new window a Web tab's page asks for opens: a ClaudeForge window, the default browser, or nowhere. */
export type NewWindowPlace = 'popup' | 'browser' | 'nowhere'

/**
 * Where a new window a page asks for opens, from its address and how it asked (Electron's
 * disposition). A popup, `window.open` with window features (`new-window`), stays the page's own,
 * in a ClaudeForge window, so a sign-in can post back to it (ADR 0006); `target=_blank` and every
 * other new window go to the default browser. Neither takes anything but an http or https address.
 */
export function whereNewWindowOpens(address: string, disposition: string): NewWindowPlace {
  if (!isPopupAddress(address)) return 'nowhere'
  return disposition === 'new-window' ? 'popup' : 'browser'
}

/**
 * The user agent Web tabs send: Electron's, without its `Electron/…` and the app's own token, so a
 * site such as Google's sign-in takes the page for a browser rather than refuse an embedded one.
 */
export function webTabUserAgent(userAgent: string, appName: string): string {
  const giveaways = ['electron', appName.toLowerCase()]
  return userAgent
    .split(' ')
    .filter((token) => !giveaways.includes(token.split('/')[0]!.toLowerCase()))
    .join(' ')
}

/**
 * What a typed command may not hold, as `--prefill` refuses them (a `claude` batch file goes through
 * cmd.exe, which would change them): a double quote, a percent sign, a line break.
 */
const FORBIDDEN = /["%\r\n]/

/** Whether a command holds what cannot be typed as it is: an action's command follows the same rule. */
export const hasForbiddenCharacter = (text: string): boolean => FORBIDDEN.test(text)

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
