import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, onEvent } from '../api'
import { tabTitle, type HostedTab } from '../terminal/hosted-sessions'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Asks before ClaudeForge closes while Claude works in Hosted sessions, naming them: closing stops
 * every `claude`, so it goes ahead only once the user agrees.
 */
export function CloseWarning({ tabs }: { tabs: HostedTab[] }): ReactNode {
  const { t } = useTranslation()
  // The Hosted sessions working when the user asked to close; null while nobody asks.
  const [working, setWorking] = useState<string[] | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => onEvent('window.closeRequested', ({ working }) => setWorking(working)), [])

  if (!working) return null
  const workingTabs = tabs.filter(({ terminal }) => terminal.hostedId !== null && working.includes(terminal.hostedId))

  return (
    <ConfirmDialog
      title={t('closing.title', { count: workingTabs.length })}
      actionLabel={t('closing.action')}
      actionIcon={X}
      busy={closing}
      onConfirm={() => {
        // The window closes once every `claude` has ended.
        setClosing(true)
        void api.window.closeAnyway()
      }}
      onCancel={() => setWorking(null)}
    >
      <ul className="close-warning__sessions">
        {workingTabs.map((tab) => (
          <li key={tab.key}>{tabTitle(tab)}</li>
        ))}
      </ul>
      <p>{t('closing.body')}</p>
    </ConfirmDialog>
  )
}
