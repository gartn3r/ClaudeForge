import { Copy, Download, Minus, Square, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateStatus } from '../../../shared/api'
import { api, onEvent } from '../api'
import type { ElementFrame } from '../elements/interface-elements'

interface TitleBarProps {
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
export function TitleBar({ tabs, menus, settings, frame }: TitleBarProps): ReactNode {
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
      <div className="brand" onContextMenu={frame?.onContextMenu}>
        {/* The wordmark: a lime marker stroke behind "Forge", never any icon. */}
        {t('app.name').replace(/Forge$/, '')}
        <span className="brand__mark">Forge</span>
      </div>
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
