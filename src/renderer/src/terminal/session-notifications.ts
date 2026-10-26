import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api, onEvent } from '../api'
import { tabTitle, type HostedSessions } from './hosted-sessions'

/**
 * Raises a Windows notification when a Hosted session in the background, one not on show or in a
 * window the user is not in, starts waiting for the user or finishes its turn. Clicking it brings
 * the window to the front and shows that Session.
 */
export function useSessionNotifications(
  sessions: HostedSessions,
  activeKey: string | null,
  enabled: boolean,
  onShow: (key: string) => void
): void {
  const { t } = useTranslation()

  useEffect(() => {
    if (!enabled) return
    return sessions.onStatus((tab) => {
      if (tab.status !== 'waiting' && tab.status !== 'done') return
      if (tab.key === activeKey && document.hasFocus()) return
      void api.window.notify({ tag: tab.key, title: tabTitle(tab), body: t(`tabs.notification.${tab.status}`) })
    })
  }, [sessions, activeKey, enabled, t])

  const show = useEffectEvent(onShow)
  useEffect(
    () =>
      onEvent('window.notificationClicked', ({ tag }) => {
        // The Session's tab may have been closed since.
        if (sessions.snapshot().tabs.some((tab) => tab.key === tag)) show(tag)
      }),
    [sessions]
  )
}
