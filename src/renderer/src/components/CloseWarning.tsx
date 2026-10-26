import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackendEvents } from '../../../shared/api'
import { api, onEvent } from '../api'
import type { EditorTab } from '../editor/editor-tabs'
import { tabsHosting, tabTitle, type HostedTab } from '../terminal/hosted-sessions'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Asks before ClaudeForge closes while Claude works in Hosted sessions or a skill's or subagent's
 * editor holds unsaved text, naming them: closing stops every `claude` and drops the unsaved text,
 * so it goes ahead only once the user agrees.
 */
export function CloseWarning({ tabs, editors }: { tabs: HostedTab[]; editors: EditorTab[] }): ReactNode {
  const { t } = useTranslation()
  // What held the window open when the user asked to close it; null while nobody asks.
  const [request, setRequest] = useState<BackendEvents['window.closeRequested'] | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => onEvent('window.closeRequested', setRequest), [])

  if (!request) return null
  const workingTabs = tabsHosting(tabs, request.working)
  const unsavedTabs = editors.filter((editor) => request.unsavedEditors.includes(editor.key))
  const working = request.working.length > 0
  const unsaved = request.unsavedEditors.length > 0
  // Each list is captioned only when the other one is shown too.
  const both = working && unsaved
  const title = both
    ? t('closing.titleBoth')
    : unsaved
      ? t('closing.titleUnsaved', { count: request.unsavedEditors.length })
      : t('closing.title', { count: request.working.length })

  return (
    <ConfirmDialog
      title={title}
      actionLabel={t('closing.action')}
      actionIcon={X}
      busy={closing}
      onConfirm={() => {
        // The window closes once every `claude` has ended.
        setClosing(true)
        void api.window.closeAnyway()
      }}
      onCancel={() => setRequest(null)}
    >
      {working && (
        <>
          {both && <p>{t('closing.workingList')}</p>}
          <ul className="close-warning__sessions" aria-label={t('closing.workingList')}>
            {workingTabs.map((tab) => (
              <li key={tab.key}>{tabTitle(tab)}</li>
            ))}
          </ul>
        </>
      )}
      {unsaved && (
        <>
          {both && <p>{t('closing.unsavedList')}</p>}
          <ul className="close-warning__sessions" aria-label={t('closing.unsavedList')}>
            {unsavedTabs.map((editor) => (
              <li key={editor.key}>
                {editor.name} · {t(`tabs.editor.${editor.kind}`)}
              </li>
            ))}
          </ul>
        </>
      )}
      {working && <p>{t('closing.body')}</p>}
      {unsaved && <p>{t('closing.bodyUnsaved')}</p>}
    </ConfirmDialog>
  )
}
