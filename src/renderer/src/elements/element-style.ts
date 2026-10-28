// How an Element's colours show in the window: on the Element itself and on what it holds, through
// the design's own roles, so its text and surfaces follow without each piece knowing.

import type { CSSProperties } from 'react'
import type { ElementProperties } from '../../../shared/elements'

/** The style an Element takes for its colours; nothing while it keeps the design's. */
export function elementStyle({ textColor, backgroundColor }: ElementProperties): CSSProperties {
  const style: Record<string, string> = {}
  if (textColor) {
    style.color = textColor
    style['--text'] = textColor
    style['--text-muted'] = `color-mix(in srgb, ${textColor} 72%, transparent)`
    style['--text-faint'] = `color-mix(in srgb, ${textColor} 56%, transparent)`
  }
  if (backgroundColor) {
    style.background = backgroundColor
    style['--surface'] = backgroundColor
  }
  return style as CSSProperties
}
