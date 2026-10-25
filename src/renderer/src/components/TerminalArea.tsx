import { FolderOpen } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { HostedTab } from '../terminal/hosted-sessions'
import type { HostedTerminal } from '../terminal/hosted-terminal'
import { panelId, tabId } from './SessionTabs'

interface TerminalAreaProps {
  tabs: HostedTab[]
  activeKey: string | null
  /** Whether the terminal on show renders with WebGL rather than the DOM renderer. */
  gpuRendering: boolean
  /** Starts a Session in the folder the user opened. */
  onStart(project: string): void
}

/**
 * The centre column, where the Hosted sessions' terminals live. Every one stays
 * mounted, so a Session in the background keeps running and keeps its
 * scrollback; only the active tab's is on show.
 */
export function TerminalArea({ tabs, activeKey, gpuRendering, onStart }: TerminalAreaProps): ReactNode {
  const { t } = useTranslation()
  const active = tabs.find((tab) => tab.key === activeKey)

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
      {tabs.map((tab) => (
        <TerminalView
          key={tab.key}
          tabKey={tab.key}
          terminal={tab.terminal}
          visible={tab.key === activeKey}
          gpuRendering={gpuRendering}
        />
      ))}
      {!active && (
        <div className="terminal-empty">
          <p className="cf-muted">{t('terminal.empty')}</p>
          {openFolderButton(true)}
        </div>
      )}
      {active?.end && (
        <div className="terminal-ended" role="status">
          <span>
            {active.end.exitCode === null
              ? t('terminal.failed')
              : t('terminal.exited', { code: active.end.exitCode })}
          </span>
          {openFolderButton(false)}
        </div>
      )}
    </main>
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
