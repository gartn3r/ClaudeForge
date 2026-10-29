import { describe, expect, it } from 'vitest'
import { TitleBar } from '../../src/renderer/src/components/TitleBar'
import { render } from './render'

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
