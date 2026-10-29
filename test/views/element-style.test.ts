import { describe, expect, it } from 'vitest'
import { elementStyle } from '../../src/renderer/src/elements/element-style'

describe("an Element's colours in the window", () => {
  it('leaves the design as it is while an Element keeps its default colours', () => {
    expect(elementStyle({})).toEqual({})
    expect(elementStyle({ textColor: null, backgroundColor: null })).toEqual({})
  })

  it('sets the text colour on what it holds, its quieter text following it', () => {
    expect(elementStyle({ textColor: '#5a2614' })).toEqual({
      color: '#5a2614',
      '--text': '#5a2614',
      '--text-muted': 'color-mix(in srgb, #5a2614 72%, transparent)',
      '--text-faint': 'color-mix(in srgb, #5a2614 56%, transparent)'
    })
  })

  it('sets the background colour as the surface what it holds sits on', () => {
    expect(elementStyle({ backgroundColor: 'oklch(0.9 0.05 40)' })).toEqual({
      background: 'oklch(0.9 0.05 40)',
      '--surface': 'oklch(0.9 0.05 40)'
    })
  })
})
