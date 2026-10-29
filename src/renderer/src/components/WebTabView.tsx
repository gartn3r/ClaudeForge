import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { WEB_TAB_PARTITION } from '../../../shared/api'
import { api } from '../api'
import { panelId, tabId } from './SessionTabs'

/** The `<webview>` methods a Web tab drives; they work once its page is attached. */
interface WebviewElement extends HTMLElement {
  getURL(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
}

/**
 * Lets the page's new windows reach the main process, which opens a sign-in popup in a ClaudeForge
 * window and every other one in the default browser.
 * The attribute must be there as the `<webview>` attaches; React leaves out a `true` it does not know.
 */
const LET_POPUPS_THROUGH = { allowpopups: 'true' } as Record<string, string>

/** Where the page is, and where the user can go from there. */
interface Place {
  address: string
  back: boolean
  forward: boolean
}

interface WebTabViewProps {
  tabKey: string
  /** The Web shortcut's address, where the page opens. */
  address: string
  visible: boolean
}

/**
 * A Web tab's page, under a small bar: Back, Forward, Reload, the current address (read-only, never
 * typed into) and Open in browser. The page runs in a `<webview>` the main process keeps apart from
 * the interface (ADR 0006); links it follows stay here, new windows open in the default browser.
 */
export function WebTabView({ tabKey, address, visible }: WebTabViewProps): ReactNode {
  const { t } = useTranslation()
  const view = useRef<WebviewElement>(null)
  const [place, setPlace] = useState<Place>({ address, back: false, forward: false })

  useEffect(() => {
    const page = view.current!
    const follow = (): void => setPlace({ address: page.getURL(), back: page.canGoBack(), forward: page.canGoForward() })
    const events = ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']
    for (const event of events) page.addEventListener(event, follow)
    return () => {
      for (const event of events) page.removeEventListener(event, follow)
    }
  }, [])

  return (
    <div className="web-tab" role="tabpanel" id={panelId(tabKey)} aria-labelledby={tabId(tabKey)} hidden={!visible}>
      <div className="web-tab__bar" role="toolbar" aria-label={t('web.bar')}>
        <button
          type="button"
          className="web-tab__nav"
          aria-label={t('web.back')}
          title={t('web.back')}
          disabled={!place.back}
          onClick={() => view.current?.goBack()}
        >
          <ArrowLeft className="cf-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="web-tab__nav"
          aria-label={t('web.forward')}
          title={t('web.forward')}
          disabled={!place.forward}
          onClick={() => view.current?.goForward()}
        >
          <ArrowRight className="cf-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="web-tab__nav"
          aria-label={t('web.reload')}
          title={t('web.reload')}
          onClick={() => view.current?.reload()}
        >
          <RotateCw className="cf-icon" aria-hidden="true" />
        </button>
        <input className="web-tab__address cf-mono" readOnly aria-label={t('web.address')} value={place.address} />
        <button
          type="button"
          className="cf-btn web-tab__browser"
          // Only a web address reaches the default browser; one the page moved to that is not is ignored.
          onClick={() => void api.web.openInBrowser(place.address).catch(() => undefined)}
        >
          <ExternalLink className="cf-icon cf-icon--sm" aria-hidden="true" />
          {t('web.openInBrowser')}
        </button>
      </div>
      <div className="web-tab__frame">
        <webview ref={view} className="web-tab__page" src={address} partition={WEB_TAB_PARTITION} {...LET_POPUPS_THROUGH} />
      </div>
    </div>
  )
}
