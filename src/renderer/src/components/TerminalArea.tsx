import { FolderOpen } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api } from '../api'
import type { EditorTab } from '../editor/editor-tabs'
import type { HostedTab } from '../terminal/hosted-sessions'
import type { HostedTerminal, TypedCommand } from '../terminal/hosted-terminal'
import { ExtensionEditor } from './ExtensionEditor'
import { panelId, tabId } from './SessionTabs'

interface TerminalAreaProps {
  tabs: HostedTab[]
  /** The skill and subagent files open in an editor. */
  editors: EditorTab[]
  /** The tab on show, a Hosted session's or an editor's. */
  activeKey: string | null
  /** Whether the terminal on show renders with WebGL rather than the DOM renderer. */
  gpuRendering: boolean
  /** Starts a Session in the folder the user opened. */
  onStart(project: string): void
  /** Closes a tab, stopping its `claude`. */
  onClose(key: string): void
  onEditorDirtyChange(key: string, dirty: boolean): void
  /** An editor saved its file under the name its frontmatter now gives. */
  onEditorRename(key: string, name: string): void
}

/**
 * The centre column, where the Hosted sessions' terminals live, and the editors
 * of skills and subagents. Every one stays mounted, so a Session in the
 * background keeps running and keeps its scrollback, and an editor its unsaved
 * text; only the active tab's is on show. A dormant tab's terminal is not
 * mounted until the tab is selected, as mounting starts `claude`.
 */
export function TerminalArea({
  tabs,
  editors,
  activeKey,
  gpuRendering,
  onStart,
  onClose,
  onEditorDirtyChange,
  onEditorRename
}: TerminalAreaProps): ReactNode {
  const { t } = useTranslation()
  const active = tabs.find((tab) => tab.key === activeKey)
  const editorShown = editors.some((editor) => editor.key === activeKey)

  const openFolder = async (): Promise<void> => {
    const project = await api.sessionHost.chooseProject()
    if (project) onStart(project)
  }

  const openFolderButton = (primary: boolean): ReactNode => (
    <button
      type="button"
      className={primary ? 'cf-btn cf-btn--primary' : 'cf-btn'}
      onClick={() => void openFolder()}
    >
      <FolderOpen className="cf-icon" aria-hidden="true" />
      {t('terminal.openFolder')}
    </button>
  )

  return (
    <main className="terminal-area" aria-label={t('terminal.label')}>
      {active?.typed && <TypedBanner typed={active.typed} onCancel={() => onClose(active.key)} />}
      {tabs.map(
        (tab) =>
          !tab.dormant && (
            <TerminalView
              key={tab.key}
              tabKey={tab.key}
              terminal={tab.terminal}
              visible={tab.key === activeKey}
              gpuRendering={gpuRendering}
            />
          )
      )}
      {editors.map((editor) => (
        <ExtensionEditor
          key={editor.key}
          tab={editor}
          visible={editor.key === activeKey}
          onDirtyChange={(dirty) => onEditorDirtyChange(editor.key, dirty)}
          onRename={(name) => onEditorRename(editor.key, name)}
        />
      ))}
      {!active && !editorShown && (
        <div className="terminal-empty cf-on-slate">
          <p className="cf-muted">{t(tabs.length ? 'terminal.dormant' : 'terminal.empty')}</p>
          {openFolderButton(true)}
        </div>
      )}
      {active?.end && (
        <div className="terminal-ended cf-on-slate" role="status">
          <span>
            {active.end.exitCode !== null
              ? t('terminal.exited', { code: active.end.exitCode })
              : active.end.missingFolder !== null
                ? t('terminal.folderMissing', { folder: active.end.missingFolder })
                : t('terminal.failed')}
          </span>
          {openFolderButton(false)}
        </div>
      )}
    </main>
  )
}

/**
 * Over a Session whose prompt holds a command ClaudeForge typed: what it starts, for the user to
 * check before pressing Enter, or to cancel, closing the Session with nothing sent.
 */
function TypedBanner({ typed, onCancel }: { typed: TypedCommand; onCancel(): void }): ReactNode {
  const { t } = useTranslation()
  return (
    <div className="terminal-typed" role="status" aria-label={t('terminal.typed.label')}>
      <span className="terminal-typed__chip" aria-hidden="true">
        {t('terminal.typed.label')}
      </span>
      <span>
        {typed.map === null ? (
          <Trans i18nKey="terminal.typed.map" values={{ ticket: typed.ticket }} components={{ b: <strong /> }} />
        ) : (
          <Trans
            i18nKey="terminal.typed.ticket"
            values={{ ticket: typed.ticket, map: typed.map }}
            components={{ b: <strong />, m: <span className="cf-muted" /> }}
          />
        )}
      </span>
      <button type="button" className="cf-btn cf-btn--ghost" onClick={onCancel}>
        {t('dialog.cancel')}
      </button>
    </div>
  )
}

interface TerminalViewProps {
  tabKey: string
  terminal: HostedTerminal
  visible: boolean
  gpuRendering: boolean
}

function TerminalView({ tabKey, terminal, visible, gpuRendering }: TerminalViewProps): ReactNode {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => terminal.attach(container.current!), [terminal])
  useEffect(() => terminal.setGpuRendering(gpuRendering), [terminal, gpuRendering])
  useEffect(() => terminal.setVisible(visible), [terminal, visible])
  return (
    <div
      ref={container}
      className="terminal-view"
      role="tabpanel"
      id={panelId(tabKey)}
      aria-labelledby={tabId(tabKey)}
      hidden={!visible}
    />
  )
}
