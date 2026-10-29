import { Copy, Download, Minus, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_TITLE_MAX_LENGTH, tidyAppTitle, type UpdateStatus } from '../../../shared/api'
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
  // The App title just kept, shown until the backend has saved it; undefined when none is saving.
  const [pendingTitle, setPendingTitle] = useState<string | null | undefined>(undefined)
  // Set once Enter or Escape has closed the field, so its blur as it goes keeps nothing more.
  const closed = useRef(false)
  const current = pendingTitle === undefined ? appTitle : pendingTitle
  const title = current ?? t('app.name')

  const edit = (): void => {
    closed.current = false
    setDraft(title)
  }
  const keep = (): void => {
    if (draft === null) return
    setDraft(null)
    const tidied = tidyAppTitle(draft)
    // ClaudeForge's own name, typed or left as it was, is no App title of the user's.
    const next = tidied === t('app.name') ? null : tidied
    if (next === current) return
    setPendingTitle(next)
    // A title kept since stays shown until its own save is done.
    void api.appState.write({ appTitle: next }).finally(() => setPendingTitle((shown) => (shown === next ? undefined : shown)))
  }
  const cancel = (): void => setDraft(null)
  const onFieldKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closed.current = true
    if (event.key === 'Enter') keep()
    else cancel()
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
          onBlur={() => !closed.current && keep()}
          // Right-clicking the text being written does not open the title bar's menu.
          onContextMenu={(event) => event.stopPropagation()}
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
