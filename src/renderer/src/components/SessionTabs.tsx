import { Check, Hand, Plus, Square, X, type LucideIcon } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { tabTitle, type HostedTab } from '../terminal/hosted-sessions'
import { ConfirmDialog } from './ConfirmDialog'

interface SessionTabsProps {
  tabs: HostedTab[]
  activeKey: string | null
  onSelect(key: string): void
  /** Stops the Hosted session's `claude` and drops its tab; for a working one, only once the user agreed. */
  onClose(key: string): void
  /** Starts a Session in the current Project. */
  onNew(): void
}

/** The tab's id and its terminal's, which name each other. */
export const tabId = (key: string): string => `session-tab-${key}`
export const panelId = (key: string): string => `session-panel-${key}`

/** What a tab's glyph shows: the Hosted session's status, or that its `claude` has ended. */
type TabState = HostedTab['status'] | 'ended'

/** Each state's StatusBadge: its modifier, and its icon where it has one rather than a dot (working's pulses). */
const STATUS_BADGE: Record<TabState, { className: string; icon?: LucideIcon }> = {
  idle: { className: 'cf-status' },
  working: { className: 'cf-status cf-status--working' },
  waiting: { className: 'cf-status cf-status--waiting', icon: Hand },
  done: { className: 'cf-status cf-status--done', icon: Check },
  ended: { className: 'cf-status cf-status--dormant' }
}

function StatusGlyph({ state }: { state: TabState }): ReactNode {
  const { className, icon: Icon } = STATUS_BADGE[state]
  return (
    <span className={className}>
      {Icon ? <Icon className="cf-icon cf-icon--sm" aria-hidden="true" /> : <span className="cf-dot" />}
    </span>
  )
}

/** The Hosted session tabs in the title bar, per the design system's TerminalTabs, and the "+" after them. */
export function SessionTabs({ tabs, activeKey, onSelect, onClose, onNew }: SessionTabsProps): ReactNode {
  const { t } = useTranslation()
  // The working Session whose tab the user asked to close.
  const [confirming, setConfirming] = useState<string | null>(null)

  const close = (tab: HostedTab): void => {
    if (!tab.end && tab.status === 'working') setConfirming(tab.key)
    else onClose(tab.key)
  }

  // Arrows move the focus along the tabs; Enter or Space shows the focused one, Delete closes it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    const tab = tabs[index]!
    const move = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (move !== undefined) {
      event.preventDefault()
      const next = tabs[(move + tabs.length) % tabs.length]!
      document.getElementById(tabId(next.key))?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(tab.key)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      close(tab)
    }
  }

  const confirmingTab = tabs.find((tab) => tab.key === confirming)

  return (
    <div className="session-tabs">
      <div className="cf-tabs" role="tablist" aria-label={t('titleBar.hostedSessions')}>
        {tabs.map((tab, index) => {
          const active = tab.key === activeKey
          const title = tabTitle(tab)
          const state: TabState = tab.end ? 'ended' : tab.status
          const statusLabel = t(`tabs.status.${state}`)
          return (
            <div
              key={tab.key}
              id={tabId(tab.key)}
              className="cf-tab"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(tab.key)}
              aria-labelledby={`${tabId(tab.key)}-title`}
              aria-describedby={`${tabId(tab.key)}-status`}
              tabIndex={active ? 0 : -1}
              title={`${title} · ${statusLabel}`}
              onClick={() => onSelect(tab.key)}
              // A middle click closes the tab, as in a browser.
              onAuxClick={(event) => event.button === 1 && close(tab)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <StatusGlyph state={state} />
              <span hidden id={`${tabId(tab.key)}-status`}>
                {statusLabel}
              </span>
              <span className="cf-tab__title" id={`${tabId(tab.key)}-title`}>
                {title}
              </span>
              <button
                type="button"
                className="cf-btn cf-btn--ghost cf-btn--icon"
                aria-label={t('tabs.close')}
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation()
                  close(tab)
                }}
              >
                <X className="cf-icon cf-icon--sm" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="cf-btn cf-btn--ghost cf-btn--icon session-tabs__new"
        aria-label={t('tabs.newSession')}
        title={t('tabs.newSession')}
        onClick={onNew}
      >
        <Plus className="cf-icon" aria-hidden="true" />
      </button>
      {confirmingTab && (
        <ConfirmDialog
          title={t('tabs.stop.title')}
          actionLabel={t('tabs.stop.action')}
          actionIcon={Square}
          onConfirm={() => {
            setConfirming(null)
            onClose(confirmingTab.key)
          }}
          onCancel={() => setConfirming(null)}
        >
          <p>{t('tabs.stop.body')}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
