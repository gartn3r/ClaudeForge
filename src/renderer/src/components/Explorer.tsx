import { PanelLeftClose, PanelLeftOpen, Puzzle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'

interface ExplorerProps {
  onCollapse(): void
}

/** The explorer column: Sessions grouped by Project, with the Extensions bar docked under it. */
export function Explorer({ onCollapse }: ExplorerProps): ReactNode {
  const { t } = useTranslation()
  return (
    <>
      <div className="cf-panel-head">
        <span className="cf-eyebrow">{t('explorer.heading')}</span>
        <IconButton icon={PanelLeftClose} label={t('explorer.collapse')} onClick={onCollapse} />
      </div>
      <div className="explorer__tree">
        <p className="empty">{t('explorer.empty')}</p>
      </div>
      <ExtensionsBar />
    </>
  )
}

export function ExtensionsBar(): ReactNode {
  const { t } = useTranslation()
  return (
    <section className="extbar" aria-label={t('extensions.heading')}>
      <span className="cf-eyebrow">{t('extensions.heading')}</span>
    </section>
  )
}

interface ExplorerRailProps {
  onExpand(): void
}

export function ExplorerRail({ onExpand }: ExplorerRailProps): ReactNode {
  const { t } = useTranslation()
  return (
    <>
      <IconButton icon={PanelLeftOpen} label={t('explorer.expand')} onClick={onExpand} />
      <div className="rail__end">
        <IconButton icon={Puzzle} label={t('extensions.heading')} onClick={onExpand} />
      </div>
    </>
  )
}
