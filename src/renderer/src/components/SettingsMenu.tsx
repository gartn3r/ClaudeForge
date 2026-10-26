import { Settings } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppState } from '../../../shared/api'
import { api } from '../api'

interface SettingsMenuProps {
  state: AppState
}

/** The title bar's settings button and the popover of preferences it opens. */
export function SettingsMenu({ state }: SettingsMenuProps): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const idPrefix = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onPointer = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div className="settings" ref={menu}>
      <button
        type="button"
        ref={button}
        className="settings__button"
        aria-label={t('settings.label')}
        title={t('settings.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Settings className="cf-icon" aria-hidden="true" />
      </button>
      {open && (
        <div className="settings__popover cf-popover" role="dialog" aria-label={t('settings.label')}>
          <div className="settings__row">
            <div>
              <div id={`${idPrefix}-gpu`}>{t('settings.gpuRendering')}</div>
              <div id={`${idPrefix}-gpu-hint`} className="settings__hint">
                {t('settings.gpuRenderingHint')}
              </div>
            </div>
            <button
              type="button"
              className="cf-toggle"
              role="switch"
              aria-checked={state.gpuRendering}
              aria-labelledby={`${idPrefix}-gpu`}
              aria-describedby={`${idPrefix}-gpu-hint`}
              autoFocus
              onClick={() => void api.appState.write({ gpuRendering: !state.gpuRendering })}
            />
          </div>
          <div className="settings__row">
            <div>
              <div id={`${idPrefix}-notifications`}>{t('settings.notifications')}</div>
              <div id={`${idPrefix}-notifications-hint`} className="settings__hint">
                {t('settings.notificationsHint')}
              </div>
            </div>
            <button
              type="button"
              className="cf-toggle"
              role="switch"
              aria-checked={state.notifications}
              aria-labelledby={`${idPrefix}-notifications`}
              aria-describedby={`${idPrefix}-notifications-hint`}
              onClick={() => void api.appState.write({ notifications: !state.notifications })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
