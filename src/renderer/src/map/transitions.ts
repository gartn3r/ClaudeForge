// What changed in a Map since the panel last drew it, so the graph can animate
// it: the Tickets added, those that joined the Frontier, those newly decided.

import { useState } from 'react'

/** The graph relayout, as the design system's motion rules set it: 320ms, ease-out. */
export const RELAYOUT_MS = 320

/** The user asked Windows for less motion: positions and states then change at once. */
export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Drawn {
  key: string
  ids: ReadonlySet<string>
  newcomers: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The ids that joined a set since it was last drawn under the same key (a Map's level, say).
 * None when the key is new, so what is there when a Map or level opens does not animate. A
 * newcomer stays one until the set changes again, so its animation is never cut short.
 */
export function useNewcomers(key: string, ids: readonly string[]): ReadonlySet<string> {
  const [drawn, setDrawn] = useState<Drawn>(() => ({ key, ids: new Set(ids), newcomers: NONE }))
  const same = drawn.key === key && drawn.ids.size === ids.length && ids.every((id) => drawn.ids.has(id))
  if (same) return drawn.newcomers
  const newcomers = drawn.key === key ? new Set(ids.filter((id) => !drawn.ids.has(id))) : NONE
  // Adjusting state while rendering, as React advises for a value derived from the previous props.
  setDrawn({ key, ids: new Set(ids), newcomers })
  return newcomers
}
