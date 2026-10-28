import type { HostedSessionStatus } from '../../../shared/api'

/** Whether two paths name the same folder; Windows paths ignore case and slash direction. */
export const samePath = (a: string, b: string): boolean => {
  const key = (path: string): string => path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return key(a) === key(b)
}

/** The Hosted session on show, while its `claude` can be typed into. */
export interface TypingTarget {
  key: string
  project: string
  status: HostedSessionStatus
}

/** Where a command goes: typed into the Hosted session on show, refused while Claude is busy there, or typed into a new Session. */
export type TypingPlan = { kind: 'type'; key: string } | { kind: 'busy'; key: string } | { kind: 'start'; project: string }

/**
 * The Skill shortcut rule (CONTEXT.md): a command is typed, never sent, into the Hosted session on
 * show when it is ready, else into a new Session of the displayed Project. A command that belongs to
 * a Project (an action) goes only into that Project's Sessions: with another Project's on show, a new
 * Session of its own Project gets it.
 */
export function planTyping(shown: TypingTarget | null, owner: string | null, displayed: string): TypingPlan {
  if (!shown || (owner !== null && !samePath(shown.project, owner))) return { kind: 'start', project: owner ?? displayed }
  // Claude is working, or waiting on the user (maybe for a permission): typing now would answer it.
  return shown.status === 'idle' || shown.status === 'done' ? { kind: 'type', key: shown.key } : { kind: 'busy', key: shown.key }
}
