import { Check, Hand, Plus, Square, Trash2, X, type LucideIcon } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorTab } from '../editor/editor-tabs'
import { tabTitle, type HostedTab } from '../terminal/hosted-sessions'
import { ConfirmDialog } from './ConfirmDialog'
import { ICONS } from './ExtensionsMenu'

interface SessionTabsProps {
  tabs: HostedTab[]
  /** The skill and subagent files open in an editor, after the Hosted sessions. */
  editors: EditorTab[]
  /** The tab on show, a Hosted session's or an editor's; null when there is none. */
  activeKey: string | null
  onSelect(key: string): void
  /** Stops the Hosted session's `claude` and drops its tab; for a working one, only once the user agreed. */
  onClose(key: string): void
  onSelectEditor(key: string): void
  /** Drops the editor's tab; with unsaved changes, only once the user agreed. */
  onCloseEditor(key: string): void
  /** Starts a Session in the current Project. */
  onNew(): void
}

/** The tab's id and its panel's (a terminal or an editor), which name each other. */
export const tabId = (key: string): string => `session-tab-${key}`
export const panelId = (key: string): string => `session-panel-${key}`

/** What a tab's glyph shows: the Hosted session's status, that its `claude` has ended, or not started yet. */
type TabState = HostedTab['status'] | 'ended' | 'dormant'

/** Each state's StatusBadge: its modifier, and its icon where it has one rather than a dot (working's pulses). */
const STATUS_BADGE: Record<TabState, { className: string; icon?: LucideIcon }> = {
  idle: { className: 'cf-status' },
  working: { className: 'cf-status cf-status--working' },
  waiting: { className: 'cf-status cf-status--waiting', icon: Hand },
  done: { className: 'cf-status cf-status--done', icon: Check },
  ended: { className: 'cf-status cf-status--dormant' },
  dormant: { className: 'cf-status cf-status--dormant' }
}

function StatusGlyph({ state }: { state: TabState }): ReactNode {
  const { className, icon: Icon } = STATUS_BADGE[state]
  return (
    <span className={className}>
      {Icon ? <Icon className="cf-icon cf-icon--sm" aria-hidden="true" /> : <span className="cf-dot" />}
    </span>
  )
}

/** One tab of the strip, whichever kind. */
interface StripTab {
  key: string
  title: string
  glyph: ReactNode
  /** Read after the title: the Session's status, or what the editor holds. */
  description: string
  /** An editor's text differs from its file. */
  unsaved: boolean
  select(): void
  /** Closes it, or asks first. */
  close(): void
}

/** What closing a tab asks first: stopping a working Session, or discarding an editor's changes. */
type Confirming = { kind: 'stop'; key: string } | { kind: 'discard'; key: string }

/**
 * The tabs in the title bar, per the design system's TerminalTabs: the Hosted sessions, then the
 * editors, and the "+" after them.
 */
export function SessionTabs({
  tabs,
  editors,
  activeKey,
  onSelect,
  onClose,
  onSelectEditor,
  onCloseEditor,
  onNew
}: SessionTabsProps): ReactNode {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState<Confirming | null>(null)

  const strip: StripTab[] = [
    ...tabs.map((tab): StripTab => {
      const state: TabState = tab.dormant ? 'dormant' : tab.end ? 'ended' : tab.status
      return {
        key: tab.key,
        title: tabTitle(tab),
        glyph: <StatusGlyph state={state} />,
        description: t(`tabs.status.${state}`),
        unsaved: false,
        select: () => onSelect(tab.key),
        close: () => {
          if (!tab.end && tab.status === 'working') setConfirming({ kind: 'stop', key: tab.key })
          else onClose(tab.key)
        }
      }
    }),
    ...editors.map((editor): StripTab => {
      const Icon = ICONS[editor.kind]
      const kind = t(`tabs.editor.${editor.kind}`)
      return {
        key: editor.key,
        title: editor.name,
        glyph: <Icon className="cf-icon cf-icon--sm" aria-hidden="true" />,
        description: editor.dirty ? `${kind} · ${t('editor.unsaved')}` : kind,
        unsaved: editor.dirty,
        select: () => onSelectEditor(editor.key),
        close: () => {
          if (editor.dirty) setConfirming({ kind: 'discard', key: editor.key })
          else onCloseEditor(editor.key)
        }
      }
    })
  ]

  // Arrows move the focus along the tabs; Enter or Space shows the focused one, Delete closes it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    const tab = strip[index]!
    const move = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: strip.length - 1 }[event.key]
    if (move !== undefined) {
      event.preventDefault()
      const next = strip[(move + strip.length) % strip.length]!
      document.getElementById(tabId(next.key))?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      tab.select()
    } else if (event.key === 'Delete') {
      event.preventDefault()
      tab.close()
    }
  }

  const stopping = confirming?.kind === 'stop' ? tabs.find((tab) => tab.key === confirming.key) : undefined
  const discarding = confirming?.kind === 'discard' ? editors.find((editor) => editor.key === confirming.key) : undefined
  // The tab Tab moves the focus to: the one on show, else the first (dormant tabs, none on show yet).
  const focusableKey = strip.some((tab) => tab.key === activeKey) ? activeKey : strip[0]?.key

  return (
    <div className="session-tabs">
      <div className="cf-tabs" role="tablist" aria-label={t('titleBar.hostedSessions')}>
        {strip.map((tab, index) => (
          <div
            key={tab.key}
            id={tabId(tab.key)}
            className={`cf-tab${tab.unsaved ? ' cf-tab--unsaved' : ''}`}
            role="tab"
            aria-selected={tab.key === activeKey}
            aria-controls={panelId(tab.key)}
            aria-labelledby={`${tabId(tab.key)}-title`}
            aria-describedby={`${tabId(tab.key)}-status`}
            tabIndex={tab.key === focusableKey ? 0 : -1}
            title={`${tab.title} · ${tab.description}`}
            onClick={tab.select}
            // A middle click closes the tab, as in a browser.
            onAuxClick={(event) => event.button === 1 && tab.close()}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.glyph}
            <span hidden id={`${tabId(tab.key)}-status`}>
              {tab.description}
            </span>
            <span className="cf-tab__title" id={`${tabId(tab.key)}-title`}>
              {tab.title}
            </span>
            <button
              type="button"
              className="cf-btn cf-btn--ghost cf-btn--icon"
              aria-label={t('tabs.close')}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation()
                tab.close()
              }}
            >
              <X className="cf-icon cf-icon--sm" aria-hidden="true" />
            </button>
          </div>
        ))}
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
      {stopping && (
        <ConfirmDialog
          title={t('tabs.stop.title')}
          actionLabel={t('tabs.stop.action')}
          actionIcon={Square}
          onConfirm={() => {
            setConfirming(null)
            onClose(stopping.key)
          }}
          onCancel={() => setConfirming(null)}
        >
          <p>{t('tabs.stop.body')}</p>
        </ConfirmDialog>
      )}
      {discarding && (
        <ConfirmDialog
          title={t('tabs.discard.title', { name: discarding.name })}
          actionLabel={t('tabs.discard.action')}
          actionIcon={Trash2}
          onConfirm={() => {
            setConfirming(null)
            onCloseEditor(discarding.key)
          }}
          onCancel={() => setConfirming(null)}
        >
          <p>{t('tabs.discard.body')}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
