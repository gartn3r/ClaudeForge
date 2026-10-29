import { describe, expect, it } from 'vitest'
import { TitleBar } from '../../src/renderer/src/components/TitleBar'
import { wordmarkParts } from '../../src/renderer/src/components/wordmark'
import { render } from './render'

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

describe('the title bar', () => {
  const brandOf = (html: string): string => /<div class="brand"[^>]*>(.*?)<\/div>/.exec(html)![1]!

  it('shows ClaudeForge until the user renames the app, never with an icon', async () => {
    const brand = brandOf(await render(<TitleBar />))
    expect(brand).toBe('Claude<span class="brand__mark">Forge</span>')
  })

  it("shows the user's App title, which they can rename in place", async () => {
    const html = await render(<TitleBar appTitle="Atelier de Paul" />)
    expect(brandOf(html)).toBe('Atelier de <span class="brand__mark brand__mark--word">Paul</span>')
    expect(html).toMatch(/<div class="brand"[^>]*title="Double-click to rename"/)
  })

  it('offers renaming in French too', async () => {
    const html = await render(<TitleBar appTitle="Atelier" />, 'fr')
    expect(html).toMatch(/<div class="brand"[^>]*title="Double-cliquez pour renommer"/)
  })
})
