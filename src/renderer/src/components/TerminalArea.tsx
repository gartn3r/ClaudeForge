import { FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { HostedTerminal, type SessionEnd } from '../terminal/hosted-terminal'

interface TerminalAreaProps {
  /** Whether the terminal renders with WebGL rather than the DOM renderer. */
  gpuRendering: boolean
}

/** The centre column, where the displayed Hosted session's terminal lives. */
export function TerminalArea({ gpuRendering }: TerminalAreaProps): ReactNode {
  const { t } = useTranslation()
  const [terminal, setTerminal] = useState<HostedTerminal | null>(null)
  const [end, setEnd] = useState<SessionEnd | null>(null)

  useEffect(() => terminal?.setGpuRendering(gpuRendering), [terminal, gpuRendering])
  useEffect(() => terminal?.onEnd(setEnd), [terminal])

  const openFolder = async (): Promise<void> => {
    const project = await api.sessionHost.chooseProject()
    if (!project) return
    terminal?.dispose()
    setEnd(null)
    setTerminal(new HostedTerminal(project, gpuRendering))
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
      {terminal ? (
        <TerminalView terminal={terminal} />
      ) : (
        <div className="terminal-empty">
          <p className="cf-muted">{t('terminal.empty')}</p>
          {openFolderButton(true)}
        </div>
      )}
      {end && (
        <div className="terminal-ended" role="status">
          <span>
            {end.exitCode === null ? t('terminal.failed') : t('terminal.exited', { code: end.exitCode })}
          </span>
          {openFolderButton(false)}
        </div>
      )}
    </main>
  )
}

function TerminalView({ terminal }: { terminal: HostedTerminal }): ReactNode {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => terminal.attach(container.current!), [terminal])
  return <div className="terminal-view" ref={container} />
}
