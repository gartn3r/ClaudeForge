// The Theme on show: the one the user picked, or Windows' while it is `system`.

import { useEffect } from 'react'
import type { Theme } from '../../shared/api'

/** What the window hears when the Theme on show changes, so what read the tokens once reads them again. */
const THEME_CHANGE = 'claudeforge:theme-change'

const WINDOWS_DARK = '(prefers-color-scheme: dark)'

/** Calls back each time the Theme on show changes; returns how to stop. */
export function onThemeChange(callback: () => void): () => void {
  window.addEventListener(THEME_CHANGE, callback)
  return () => window.removeEventListener(THEME_CHANGE, callback)
}

/** Shows the Theme the user picked on the document, following Windows while it is `system`. */
export function useTheme(theme: Theme): void {
  useEffect(() => {
    const windows = window.matchMedia(WINDOWS_DARK)
    const show = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && windows.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      window.dispatchEvent(new Event(THEME_CHANGE))
    }
    show()
    if (theme !== 'system') return
    windows.addEventListener('change', show)
    return () => windows.removeEventListener('change', show)
  }, [theme])
}
