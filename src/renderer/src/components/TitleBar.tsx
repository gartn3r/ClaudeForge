import { Copy, Download, Minus, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_TITLE_MAX_LENGTH, type UpdateStatus } from '../../../shared/api'
import { api, onEvent } from '../api'
import type { ElementFrame } from '../elements/interface-elements'
import { wordmarkParts } from './wordmark'

interface TitleBarProps {
  /** The App title the user gave; null or left out for ClaudeForge's own name. */
  appTitle?: string | null
  /** The Hosted session tabs; the first-run screen has none. */
  tabs?: ReactNode
  /** The displayed Project's menus and Restore default layout, after the Hosted session tabs. */
  menus?: ReactNode
  /** The settings menu, beside the window controls. */
  settings?: ReactNode
  /** What it takes from its Element: its colours, and its right-click menu on the wordmark. */
  frame?: ElementFrame
}

/** The custom title bar of the frameless window: name, Hosted session tabs, menus, window controls. */
export function TitleBar({ appTitle = null, tabs, menus, settings, frame }: TitleBarProps): ReactNode {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'current' })

  useEffect(() => {
    void api.window.isMaximized().then(setMaximized)
    return onEvent('window.maximizedChanged', ({ maximized }) => setMaximized(maximized))
  }, [])

  useEffect(() => {
    void api.updates.status().then(setUpdate)
    return onEvent('updates.changed', setUpdate)
  }, [])

  const MaximizeIcon = maximized ? Copy : Square
  const maximizeLabel = maximized ? t('titleBar.restore') : t('titleBar.maximize')

  return (
    <header className="titlebar" style={frame?.style}>
      <Wordmark appTitle={appTitle} onContextMenu={frame?.onContextMenu} />
      {tabs}
      {menus}
      {update.state === 'ready' && (
        <span className="cf-chip titlebar__update" role="status" title={t('titleBar.updateReadyHint', update)}>
          <Download className="cf-icon cf-icon--sm" aria-hidden="true" />
          {t('titleBar.updateReady', update)}
        </span>
      )}
      {settings}
      <div className="wincontrols">
        <button
          type="button"
          aria-label={t('titleBar.minimize')}
          title={t('titleBar.minimize')}
          onClick={() => void api.window.minimize()}
        >
          <Minus className="cf-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={() => void api.window.toggleMaximize()}
        >
          <MaximizeIcon className="cf-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="close"
          aria-label={t('titleBar.close')}
          title={t('titleBar.close')}
          onClick={() => void api.window.close()}
        >
          <X className="cf-icon" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}

/** The App title as the user writes it: blank gives back ClaudeForge's own name, as the backend keeps it. */
const tidyAppTitle = (draft: string): string | null => draft.trim().slice(0, APP_TITLE_MAX_LENGTH).trim() || null

interface WordmarkProps {
  appTitle: string | null
  onContextMenu?: ElementFrame['onContextMenu']
}

/**
 * The wordmark: the App title with a lime marker stroke behind its last word, never any icon. A
 * double-click (or Enter or F2 on it) renames it in place: Enter or leaving the field keeps the new
 * title, Escape leaves it as it was.
 */
function Wordmark({ appTitle, onContextMenu }: WordmarkProps): ReactNode {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)
  // The title just kept, shown until the backend has saved it.
  const [saving, setSaving] = useState<{ title: string | null } | null>(null)
  // Set once Enter or Escape has ended the edit, so the field's blur as it goes keeps nothing more.
  const ended = useRef(false)
  const title = (saving ? saving.title : appTitle) ?? t('app.name')

  const edit = (): void => {
    ended.current = false
    setDraft(title)
  }
  const keep = (): void => {
    if (draft === null) return
    const next = tidyAppTitle(draft)
    setDraft(null)
    if (next === appTitle) return
    setSaving({ title: next })
    void api.appState.write({ appTitle: next }).finally(() => setSaving(null))
  }
  const end = (keeping: boolean): void => {
    ended.current = true
    if (keeping) keep()
    else setDraft(null)
  }
  const onFieldKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    end(event.key === 'Enter')
  }

  if (draft !== null) {
    return (
      <div className="brand" onContextMenu={onContextMenu}>
        <input
          className="brand__field"
          aria-label={t('titleBar.appTitle')}
          value={draft}
          maxLength={APP_TITLE_MAX_LENGTH}
          spellCheck={false}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onFieldKey}
          onBlur={() => !ended.current && keep()}
        />
      </div>
    )
  }

  const { lead, marked } = wordmarkParts(title)
  return (
    <div
      className="brand"
      title={t('titleBar.renameHint')}
      tabIndex={0}
      onDoubleClick={edit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'F2') return
        event.preventDefault()
        edit()
      }}
      onContextMenu={onContextMenu}
    >
      {lead}
      {/* After a space, the stroke reaches back into it rather than widening it. */}
      <span className={/\s$/.test(lead) ? 'brand__mark brand__mark--word' : 'brand__mark'}>{marked}</span>
    </div>
  )
}
