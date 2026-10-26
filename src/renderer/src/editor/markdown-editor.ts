// CodeMirror, set up for a skill's or subagent's file: Markdown with its YAML frontmatter, each
// highlighted as such, in the terminal's colours.

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
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--terminal-well)' },
    '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.5' },
    '.cm-content': { padding: 'var(--space-2) 0', caretColor: 'var(--brass)' },
    '.cm-line': { padding: '0 var(--space-3)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--brass)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--selection)'
    },
    '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 3%)' },
    '.cm-gutters': { border: 0, backgroundColor: 'var(--terminal-well)', color: 'var(--text-faint)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' }
  },
  { dark: true }
)

/** The ANSI tokens the terminal uses, so a file reads like Claude Code's own output. */
const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ansi-bright-blue)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--route)' },
  { tag: tags.monospace, color: 'var(--ansi-cyan)' },
  { tag: tags.quote, color: 'var(--text-muted)' },
  // Markdown's marks (#, *, `, >) and the frontmatter's --- lines.
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--text-faint)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--ansi-magenta)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ansi-green)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [tags.labelName, tags.typeName, tags.keyword], color: 'var(--ansi-yellow)' },
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
