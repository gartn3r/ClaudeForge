import type { EditorView } from '@codemirror/view'
import { CircleAlert, Save } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ExtensionFileKind, FrontmatterProblem } from '../../../shared/api'
import { frontmatterFields, frontmatterProblems } from '../../../shared/frontmatter'
import { api } from '../api'
import type { EditorTab } from '../editor/editor-tabs'
import { createMarkdownEditor } from '../editor/markdown-editor'
import { ICONS } from './ExtensionsMenu'
import { panelId, tabId } from './SessionTabs'

/** How the editor tells the user what to fix before the file can be saved. */
function problemText(t: TFunction, kind: ExtensionFileKind, problem: FrontmatterProblem): string {
  switch (problem.code) {
    case 'no-frontmatter':
      return t('editor.problem.noFrontmatter')
    case 'unclosed-frontmatter':
      return t('editor.problem.unclosed')
    case 'not-yaml':
      return t('editor.problem.notYaml', { line: problem.line, detail: problem.detail })
    case 'not-fields':
      return t('editor.problem.notFields')
    case 'missing':
      return t('editor.problem.missing', { field: problem.field })
    case 'not-text':
      return t('editor.problem.notText', { field: problem.field })
    case 'bad-name':
      return t(kind === 'skill' ? 'editor.problem.badSkillName' : 'editor.problem.badSubagentName')
    case 'too-long':
      return t('editor.problem.tooLong', { field: problem.field, max: problem.max })
  }
}

/** What Claude Code names a skill or subagent without a name: its folder, or its file. */
const nameOfFile = (kind: ExtensionFileKind, file: string): string => {
  const parts = file.split(/[\\/]/)
  return kind === 'skill' ? parts.at(-2)! : parts.at(-1)!.replace(/\.md$/i, '')
}

/** The file as CodeMirror holds it: \n line endings, which the backend gives back to a \r\n file. */
const editorText = (text: string): string => text.replace(/\r\n?/g, '\n')

interface ExtensionEditorProps {
  tab: EditorTab
  visible: boolean
  onDirtyChange(dirty: boolean): void
  /** Saved under the name its frontmatter now gives. */
  onRename(name: string): void
}

/**
 * A skill's or subagent's file in the centre column: Markdown under its YAML frontmatter, which is
 * checked as the user types. Saving waits until the frontmatter is valid. Like a terminal, it stays
 * mounted while another tab is on show, keeping its unsaved text and its undo history.
 */
export function ExtensionEditor({ tab, visible, onDirtyChange, onRename }: ExtensionEditorProps): ReactNode {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const problemsId = useId()
  const [loaded, setLoaded] = useState<'loading' | 'failed' | 'ready'>('loading')
  /** The text in the editor, and as the file was last read or saved. */
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const problems = loaded === 'ready' ? frontmatterProblems(tab.kind, text) : []
  const dirty = text !== saved
  const canSave = loaded === 'ready' && dirty && problems.length === 0 && !saving

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    setSaveFailed(false)
    try {
      // The backend checks the frontmatter as the editor does, so it refuses nothing the editor allows.
      const result = await api.extensions.save(tab.project, tab.file, text)
      if (result.ok) {
        setSaved(text)
        setSavedOnce(true)
        const { name } = frontmatterFields(text)
        onRename((typeof name === 'string' && name.trim()) || nameOfFile(tab.kind, tab.file))
      } else {
        setSaveFailed(true)
      }
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const onSave = useEffectEvent(() => void save())
  /** Puts CodeMirror in place once the file is read, focused if the tab is on show. */
  const mount = useEffectEvent((initial: string) => {
    view.current = createMarkdownEditor({
      parent: container.current!,
      text: initial,
      label: t('editor.label', { name: tab.name }),
      onChange: setText,
      onSave: () => onSave()
    })
    if (visible) view.current.focus()
  })
  const dirtyChanged = useEffectEvent(onDirtyChange)

  useEffect(() => {
    let current = true
    api.extensions.read(tab.project, tab.file).then(
      (file) => {
        if (!current) return
        const initial = editorText(file.text)
        setText(initial)
        setSaved(initial)
        setLoaded('ready')
        mount(initial)
      },
      () => current && setLoaded('failed')
    )
    return () => {
      current = false
      view.current?.destroy()
      view.current = null
    }
  }, [tab.project, tab.file])

  useEffect(() => {
    if (!visible) return
    view.current?.requestMeasure()
    view.current?.focus()
  }, [visible])

  useEffect(() => dirtyChanged(dirty), [dirty])

  const Icon = ICONS[tab.kind]
  const state = saving ? t('editor.saving') : dirty ? t('editor.unsaved') : savedOnce ? t('editor.saved') : ''

  return (
    <section
      className="ext-editor"
      role="tabpanel"
      id={panelId(tab.key)}
      aria-labelledby={tabId(tab.key)}
      hidden={!visible}
    >
      <div className="ext-editor__bar">
        <Icon className="cf-icon" aria-hidden="true" />
        <span className="ext-editor__name">{tab.name}</span>
        <span className="cf-chip">{t(`extensions.origin.${tab.scope}`)}</span>
        <span className="ext-editor__path" title={tab.file}>
          {tab.file}
        </span>
        <span className="ext-editor__state" aria-live="polite">
          {state}
        </span>
        <button
          type="button"
          className="cf-btn cf-btn--primary"
          disabled={!canSave}
          aria-describedby={problems.length > 0 ? problemsId : undefined}
          onClick={() => void save()}
        >
          <Save className="cf-icon" aria-hidden="true" />
          {t('editor.save')}
        </button>
      </div>
      {problems.length > 0 && (
        <div className="ext-editor__problems" id={problemsId} role="status">
          <CircleAlert className="cf-icon cf-icon--sm" aria-hidden="true" />
          <div>
            <p>{t('editor.problems')}</p>
            <ul>
              {problems.map((problem) => (
                <li key={JSON.stringify(problem)}>{problemText(t, tab.kind, problem)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {saveFailed && (
        <p className="ext-editor__note ext-editor__note--problem" role="alert">
          {t('editor.saveFailed')}
        </p>
      )}
      {loaded === 'loading' && <p className="ext-editor__note">{t('editor.loading')}</p>}
      {loaded === 'failed' && (
        <p className="ext-editor__note ext-editor__note--problem" role="alert">
          {t('editor.loadFailed')}
        </p>
      )}
      <div ref={container} className="ext-editor__code" />
    </section>
  )
}
