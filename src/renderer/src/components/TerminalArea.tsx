import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** The centre column, where the displayed Hosted session's terminal lives. */
export function TerminalArea(): ReactNode {
  const { t } = useTranslation()
  return (
    <main className="terminal-area" aria-label={t('terminal.label')}>
      <p className="empty">{t('terminal.empty')}</p>
    </main>
  )
}
