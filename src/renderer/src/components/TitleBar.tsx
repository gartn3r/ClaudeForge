import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, onEvent } from '../api'

interface TitleBarProps {
  /** The Hosted session tabs; the first-run screen has none. */
  tabs?: ReactNode
  /** The settings menu, beside the window controls. */
  settings?: ReactNode
}

/** The custom title bar of the frameless window: name, Hosted session tabs, window controls. */
export function TitleBar({ tabs, settings }: TitleBarProps): ReactNode {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void api.window.isMaximized().then(setMaximized)
    return onEvent('window.maximizedChanged', ({ maximized }) => setMaximized(maximized))
  }, [])

  const MaximizeIcon = maximized ? Copy : Square
  const maximizeLabel = maximized ? t('titleBar.restore') : t('titleBar.maximize')

  return (
    <header className="titlebar">
      <div className="brand">{t('app.name')}</div>
      {tabs}
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
