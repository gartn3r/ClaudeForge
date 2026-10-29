// CodeMirror, set up for a skill's or subagent's file: Markdown with its YAML frontmatter, each
// highlighted as such, on the editor card's cream well.

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { tags } from '@lezer/highlight'

const theme = EditorView.theme(
  {
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--ground)' },
    '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '15px', lineHeight: '1.7' },
    '.cm-content': { padding: 'var(--space-4) 0', caretColor: 'var(--slate)' },
    '.cm-line': { padding: '0 18px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--slate)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--selection)'
    },
    '.cm-activeLine': { backgroundColor: 'rgba(47, 53, 63, 0.04)' },
    '.cm-gutters': {
      border: 0,
      borderRight: '1px solid var(--line)',
      backgroundColor: 'var(--ground)',
      color: 'var(--text-faint)'
    },
    '.cm-gutterElement': { padding: '0 12px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' }
  },
  { dark: false }
)

/** The editor's highlighting on cream: the frontmatter's keys in dark lime, headings in bold slate. */
const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--text)', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent-text)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--accent-text)' },
  { tag: tags.quote, color: 'var(--text-muted)' },
  // Markdown's marks (#, *, `, >) and the frontmatter's --- lines.
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--text-muted)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--accent-text)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--text)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [tags.labelName, tags.typeName, tags.keyword], color: 'var(--accent-text)' },
  { tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace], color: 'var(--text-muted)' }
])

export interface MarkdownEditorOptions {
  parent: HTMLElement
  text: string
  /** Names the text box for assistive technology. */
  label: string
  /** After every change to the text, with the whole text. */
  onChange(text: string): void
  /** Ctrl+S. */
  onSave(): void
}

export function createMarkdownEditor({ parent, text, label, onChange, onSave }: MarkdownEditorOptions): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSave()
              return true
            }
          },
          ...defaultKeymap,
          ...historyKeymap
        ]),
        yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
        syntaxHighlighting(highlighting),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        })
      ]
    })
  })
}
