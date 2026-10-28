import { describe, expect, it, vi } from 'vitest'
import { ContentItemView, activateItem } from '../../src/renderer/src/elements/ContentItemView'
import { WEB_TAB_PARTITION } from '../../src/shared/api'
import type { ContentItem, ElementView } from '../../src/shared/elements'
import { render } from './render'

const project = 'C:\\projects\\recipe-box'

const element = (kind: 'panel-tab' | 'card' | 'menu'): ElementView => ({
  id: `${kind}:tests`,
  project,
  kind,
  container: kind === 'panel-tab' ? 'right-panel' : kind === 'card' ? 'explorer' : 'title-bar',
  properties: {},
  takes: [],
  contentKinds: [],
  items: [],
  attention: null
})

const byUser = { writtenBy: { kind: 'user' } } as const
const text: ContentItem = { id: 'summary', kind: 'text', text: '**11** passed\n\n- `auth` failed', ...byUser }
const link: ContentItem = { id: 'ci', kind: 'link', title: 'CI run', address: 'https://ci.example.com/runs/42', ...byUser }
const file: ContentItem = {
  id: 'coverage',
  kind: 'file',
  path: 'C:\\projects\\recipe-box\\coverage.md',
  file: { state: 'present', size: 12, modifiedAt: 1 },
  ...byUser
}
const missing: ContentItem = { ...file, id: 'gone', file: { state: 'missing' } }
const page: ContentItem = { id: 'report', kind: 'web-page', title: 'Coverage', address: 'http://localhost:5173/coverage', ...byUser }
const action: ContentItem = { id: 'rerun', kind: 'action', title: 'Run again', command: '/run-tests --watch', ...byUser }

const noType = (): void => undefined

describe('the Content item view', () => {
  it('shows a text as markdown', async () => {
    const html = await render(<ContentItemView element={element('panel-tab')} item={text} onType={noType} />)
    expect(html).toContain('<strong>11</strong> passed')
    expect(html).toContain('<li><code>auth</code> failed</li>')
  })

  it('shows a link by its title and where it leads', async () => {
    const html = await render(<ContentItemView element={element('card')} item={link} onType={noType} />)
    expect(html).toContain('CI run')
    expect(html).toContain('ci.example.com')
  })

  it("shows a file in a Panel tab, as missing when it is gone, and as a link to it in a card", async () => {
    expect(await render(<ContentItemView element={element('panel-tab')} item={file} onType={noType} />)).toContain('coverage.md')
    expect(await render(<ContentItemView element={element('panel-tab')} item={missing} onType={noType} />)).toContain(
      'This file is missing'
    )
    expect(await render(<ContentItemView element={element('panel-tab')} item={missing} onType={noType} />, 'fr')).toContain(
      'Ce fichier est introuvable'
    )
    const inCard = await render(<ContentItemView element={element('card')} item={file} onType={noType} />)
    expect(inCard).toMatch(/<button[^>]*>.*coverage\.md/)
  })

  it('shows a web page apart from the interface, in the storage Web tabs keep away from it (ADR 0006)', async () => {
    const html = await render(<ContentItemView element={element('panel-tab')} item={page} onType={noType} />)
    const webview = /<webview[^>]*>/.exec(html)?.[0]
    expect(webview).toContain(`src="${page.kind === 'web-page' && page.address}"`)
    expect(webview).toContain(`partition="${WEB_TAB_PARTITION}"`)
    // No preload, so no bridge: the main process strips it from any page the window attaches.
    expect(webview).not.toContain('preload')
    expect(webview).not.toContain('nodeintegration')
  })

  it('shows an action by its title and the command it types', async () => {
    const html = await render(<ContentItemView element={element('menu')} item={action} onType={noType} />)
    expect(html).toContain('Run again')
    expect(html).toContain('&gt; /run-tests --watch')
  })
})

describe('using a Content item', () => {
  const handlers = () => ({ type: vi.fn(), openInBrowser: vi.fn(), openFile: vi.fn() })

  it('types an action without sending it, in its Project', () => {
    const used = handlers()
    activateItem(element('card'), action, used)
    expect(used.type).toHaveBeenCalledWith('/run-tests --watch', 'Run again', project)
    // No line break: the command waits in the prompt for the user to send it.
    expect(used.type.mock.calls[0]![0]).not.toMatch(/[\r\n]/)
    expect(used.openInBrowser).not.toHaveBeenCalled()
  })

  it('opens a link in the default browser, and a file shown as a link in its default app', () => {
    const used = handlers()
    activateItem(element('menu'), link, used)
    activateItem(element('card'), file, used)
    expect(used.openInBrowser).toHaveBeenCalledWith('https://ci.example.com/runs/42')
    expect(used.openFile).toHaveBeenCalledWith(file)
    expect(used.type).not.toHaveBeenCalled()
  })
})
