import { describe, expect, it } from 'vitest'
import { CreateElementDialog, suggestedName } from '../../src/renderer/src/elements/CreateElementDialog'
import { RightPanel } from '../../src/renderer/src/elements/RightPanel'
import { DEFAULT_MAP_TAB, rightPanelState } from '../../src/renderer/src/elements/right-panel'
import { CONTENT_KINDS, PROPERTIES_TAKEN, type ContentItem, type ElementView } from '../../src/shared/elements'
import { render } from './render'

const project = 'C:\\projects\\recipe-box'
const byUser = { writtenBy: { kind: 'user' } } as const

const tab = (name: string, more: Partial<ElementView> = {}): ElementView => ({
  id: `panel-tab:${name}`,
  project,
  kind: 'panel-tab',
  container: 'right-panel',
  properties: { visible: true, order: 1, title: name, textColor: null, backgroundColor: null },
  takes: PROPERTIES_TAKEN['panel-tab'],
  contentKinds: CONTENT_KINDS,
  items: [],
  attention: null,
  ...more
})

const items: ContentItem[] = [
  { id: 'summary', kind: 'text', text: '**248** passed', ...byUser },
  { id: 'ci', kind: 'link', title: 'CI run', address: 'https://ci.example.com/runs/42', ...byUser },
  { id: 'rerun', kind: 'action', title: 'Run again', command: '/run-tests --only-failed', ...byUser }
]

const tests = tab('tests', { properties: { ...tab('tests').properties, title: 'Test report' }, items })
const coverage = tab('coverage', { attention: 'mark' })

const panel = (chosen: string | null, language: 'en' | 'fr' = 'en'): Promise<string> =>
  render(
    <RightPanel
      state={rightPanelState({ elements: [DEFAULT_MAP_TAB, tests, coverage], chosen, hasMap: true, openedAnyway: false })}
      project={project}
      map={<p>The Map panel</p>}
      collapseLabel="Collapse"
      onChoose={() => undefined}
      onCollapse={() => undefined}
      onType={() => undefined}
    />,
    language
  )

const tabsOf = (html: string): string[] => [...html.matchAll(/<button[^>]*role="tab"[^>]*>(.*?)<\/button>/g)].map(([, inner]) => inner!)

describe('the Right panel', () => {
  it('lists its Panel tabs in its header, the Map first, then a + that creates one', async () => {
    const html = await panel(null)
    const tabs = tabsOf(html)
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toContain('Map')
    expect(tabs[1]).toContain('Test report')
    expect(tabs[2]).toContain('coverage')
    expect(html).toMatch(/role="tablist" aria-label="Panel tabs"/)
    expect(html).toContain('aria-label="New Panel tab"')
    expect(html.indexOf('New Panel tab')).toBeGreaterThan(html.indexOf('coverage'))
  })

  it('shows the Map panel under the Map Panel tab', async () => {
    const html = await panel(null)
    expect(html).toMatch(/<button[^>]*aria-selected="true"[^>]*>.*?Map/)
    expect(html).toContain('The Map panel')
  })

  it('marks a Panel tab whose content changed while not on show', async () => {
    const [, , marked] = tabsOf(await panel(null))
    expect(marked).toContain('aria-label="Changed"')
    expect(tabsOf(await panel(null, 'fr'))[2]).toContain('aria-label="Modifié"')
  })

  it('shows a Created Panel tab’s title, identifier and Content items', async () => {
    const html = await panel('panel-tab:tests')
    expect(html).not.toContain('The Map panel')
    expect(html).toMatch(/<h2[^>]*>Test report<\/h2>/)
    expect(html).toContain('panel-tab:tests')
    expect(html).toContain('<strong>248</strong> passed')
    expect(html).toContain('CI run')
    expect(html).toContain('&gt; /run-tests --only-failed')
  })

  it('says how to fill an empty Panel tab', async () => {
    const html = await panel('panel-tab:coverage')
    expect(html).toContain('Nothing here yet')
    expect(await panel('panel-tab:coverage', 'fr')).toContain('Rien ici pour l’instant')
  })

  it('wears the colours given to a Panel tab', async () => {
    const coloured = tab('release', { properties: { ...tab('release').properties, textColor: '#5a2614', backgroundColor: '#f3d6c6' } })
    const html = await render(
      <RightPanel
        state={rightPanelState({ elements: [DEFAULT_MAP_TAB, coloured], chosen: 'panel-tab:release', hasMap: true, openedAnyway: false })}
        project={project}
        map={null}
        collapseLabel="Collapse"
        onChoose={() => undefined}
        onCollapse={() => undefined}
        onType={() => undefined}
      />
    )
    expect(html).toMatch(/role="tab"[^>]*style="color:#5a2614;background:#f3d6c6"/)
  })
})

describe('the dialog that creates an Element', () => {
  it('asks for a title and an identifier under the kind’s prefix', async () => {
    const html = await render(<CreateElementDialog kind="panel-tab" project={project} onDone={() => undefined} />)
    expect(html).toContain('New Panel tab')
    expect(html).toContain('In recipe-box.')
    expect(html).toContain('Title')
    expect(html).toContain('Identifier')
    expect(html).toContain('panel-tab:')
    expect(html).toContain('Create')
  })

  it('speaks French', async () => {
    const html = await render(<CreateElementDialog kind="panel-tab" project={project} onDone={() => undefined} />, 'fr')
    expect(html).toContain('Nouveau Panel tab')
    expect(html).toContain('Identifiant')
    expect(html).toContain('Créer')
  })

  it('suggests an identifier from the title', () => {
    expect(suggestedName('Rapport de tests')).toBe('rapport-de-tests')
    expect(suggestedName('  Coverage (v2) — main ')).toBe('coverage-v2-main')
    expect(suggestedName('Été à Noël')).toBe('ete-a-noel')
    expect(suggestedName('x'.repeat(60))).toHaveLength(40)
  })
})
