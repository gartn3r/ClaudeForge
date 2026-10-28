import { ExternalLink, FileText, Globe, Link2, Play, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { WEB_TAB_PARTITION } from '../../../shared/api'
import { itemLabel, opensAsDocument, type ContentItem, type ElementView } from '../../../shared/elements'
import { api } from '../api'
import { MapText } from '../components/MapText'

/** How a Content item is used once clicked, given by the window around it. */
export interface ItemHandlers {
  /** Types a command without sending it, by the Skill shortcut rule, into a Session of the Project it belongs to. */
  type(command: string, name: string, project: string | null): void
  openInBrowser(address: string): void
  /** Opens a file Content item in its default app, when it is a document. */
  openFile(item: Extract<ContentItem, { kind: 'file' }>): void
}

/**
 * What clicking a Content item does: a link opens in the default browser; an action types its
 * command, never sending it, in its Element's Project; a file shown as a link opens in its default
 * app. A text, and a file or web page shown in full, are only read.
 */
export function activateItem(element: ElementView, item: ContentItem, handlers: ItemHandlers): void {
  if (item.kind === 'link') handlers.openInBrowser(item.address)
  else if (item.kind === 'action') handlers.type(item.command, itemLabel(item), element.project)
  else if (item.kind === 'file' && element.kind !== 'panel-tab') handlers.openFile(item)
}

/** The handlers that reach the backend; only typing depends on the window's Sessions. */
const handlersFor = (element: ElementView, onType: ItemHandlers['type']): ItemHandlers => ({
  type: onType,
  // Only a web page reaches the default browser; the contract took no other link.
  openInBrowser: (address) => void api.web.openInBrowser(address).catch(() => undefined),
  openFile: (item) =>
    void api.elements
      .request({ op: 'open-file', project: element.project ?? undefined, element: element.id, item: item.id })
      .catch(() => undefined)
})

/** Where a link leads, short: its host, or the page's file name. */
function placeOf(address: string): string {
  try {
    const url = new URL(address)
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname.split('/').pop() ?? '') || address : url.host
  } catch {
    return address
  }
}

interface ContentItemViewProps {
  /** The Element holding it: a Panel tab shows every kind in full, a card or a menu more briefly. */
  element: ElementView
  item: ContentItem
  onType: ItemHandlers['type']
}

/**
 * One Content item, as any Element shows it. A web page runs apart from the interface, as a Web tab's
 * does (ADR 0006): the main process strips every `<webview>` the window attaches of the preload
 * script and its bridge, and keeps its storage in the Web tabs' partition.
 */
export function ContentItemView({ element, item, onType }: ContentItemViewProps): ReactNode {
  const { t } = useTranslation()
  const handlers = handlersFor(element, onType)
  const activate = (): void => activateItem(element, item, handlers)
  const full = element.kind === 'panel-tab'
  const label = itemLabel(item)

  switch (item.kind) {
    case 'text':
      return (
        <div className="content-item content-item--text">
          <MapText markdown={item.text} />
        </div>
      )
    case 'link':
      return (
        <button type="button" className="content-item content-item--link" title={item.address} onClick={activate}>
          <Link2 className="cf-icon cf-icon--sm" aria-hidden="true" />
          <span className="content-item__label">{label}</span>
          <span className="content-item__detail cf-mono">{placeOf(item.address)}</span>
        </button>
      )
    case 'action':
      return (
        <button type="button" className="content-item content-item--action" title={t('elements.item.typeHint')} onClick={activate}>
          <Play className="cf-icon cf-icon--sm" aria-hidden="true" />
          <span className="content-item__label">{label}</span>
          <code className="content-item__detail cf-mono">{`> ${item.command}`}</code>
        </button>
      )
    case 'web-page':
      return <PageView address={item.address} label={label} />
    case 'file': {
      const missing = item.file?.state === 'missing'
      if (full) return <FileView element={element} item={item} label={label} />
      return (
        <button
          type="button"
          className="content-item content-item--file"
          title={missing ? t('elements.item.fileMissing') : item.path}
          disabled={missing || !opensAsDocument(item.path)}
          onClick={activate}
        >
          <FileText className="cf-icon cf-icon--sm" aria-hidden="true" />
          <span className="content-item__label">{label}</span>
          {missing && <span className="content-item__detail">{t('elements.item.missing')}</span>}
        </button>
      )
    }
  }
}

/** A file in full: its text as it is on disk now, read again whenever it changes; or why it cannot show. */
function FileView({
  element,
  item,
  label
}: {
  element: ElementView
  item: Extract<ContentItem, { kind: 'file' }>
  label: string
}): ReactNode {
  const { t } = useTranslation()
  const [text, setText] = useState<string | null | undefined>(undefined)
  const modifiedAt = item.file?.state === 'present' ? item.file.modifiedAt : null

  useEffect(() => {
    let current = true
    void api.elements
      .request({ op: 'read-file', project: element.project ?? undefined, element: element.id, item: item.id })
      .then((result) => current && setText(result.ok ? result.text : null))
      .catch(() => current && setText(null))
    return () => {
      current = false
    }
  }, [element.project, element.id, item.id, modifiedAt])

  const missing = item.file?.state === 'missing'
  return (
    <section className="content-item content-item--file-full" aria-label={label}>
      <header className="content-item__head">
        <FileText className="cf-icon cf-icon--sm" aria-hidden="true" />
        <span className="content-item__label" title={item.path}>
          {label}
        </span>
      </header>
      {missing ? (
        <p className="content-item__notice" role="status">
          <TriangleAlert className="cf-icon cf-icon--sm" aria-hidden="true" />
          {t('elements.item.fileMissing')}
        </p>
      ) : text === null ? (
        <p className="content-item__notice">{t('elements.item.fileNotShown')}</p>
      ) : text === undefined ? null : /\.(md|markdown)$/i.test(item.path) ? (
        <MapText markdown={text} />
      ) : (
        <pre className="content-item__file-text cf-mono">{text}</pre>
      )}
    </section>
  )
}

/** A web page in full, under its title and Open in browser. */
function PageView({ address, label }: { address: string; label: string }): ReactNode {
  const { t } = useTranslation()
  return (
    <section className="content-item content-item--page" aria-label={label}>
      <header className="content-item__head">
        <Globe className="cf-icon cf-icon--sm" aria-hidden="true" />
        <span className="content-item__label" title={address}>
          {label}
        </span>
        <button
          type="button"
          className="cf-btn cf-btn--ghost content-item__browser"
          onClick={() => void api.web.openInBrowser(address).catch(() => undefined)}
        >
          <ExternalLink className="cf-icon cf-icon--sm" aria-hidden="true" />
          {t('web.openInBrowser')}
        </button>
      </header>
      <webview className="content-item__page" src={address} partition={WEB_TAB_PARTITION} />
    </section>
  )
}
