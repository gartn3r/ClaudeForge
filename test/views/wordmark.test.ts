import { describe, expect, it } from 'vitest'
import { wordmarkParts } from '../../src/renderer/src/components/wordmark'

describe('the wordmark', () => {
  it('puts the marker stroke behind the last word of the App title', () => {
    expect(wordmarkParts('Atelier de Paul')).toEqual({ lead: 'Atelier de ', marked: 'Paul' })
    expect(wordmarkParts('Studio 42')).toEqual({ lead: 'Studio ', marked: '42' })
  })

  it('puts it behind the last part of a word written in camel case, as behind "Forge" in ClaudeForge', () => {
    expect(wordmarkParts('ClaudeForge')).toEqual({ lead: 'Claude', marked: 'Forge' })
    expect(wordmarkParts('MyApp')).toEqual({ lead: 'My', marked: 'App' })
    expect(wordmarkParts('Notes de ClaudeForge')).toEqual({ lead: 'Notes de Claude', marked: 'Forge' })
  })

  it('puts it behind the whole of a title of one plain word', () => {
    expect(wordmarkParts('atelier')).toEqual({ lead: '', marked: 'atelier' })
    expect(wordmarkParts('HTTP')).toEqual({ lead: '', marked: 'HTTP' })
  })
})
