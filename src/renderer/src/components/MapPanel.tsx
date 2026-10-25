import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'

interface MapPanelProps {
  onCollapse(): void
}

/** The Map panel: the Wayfinder Map of the displayed Session's Project. */
export function MapPanel({ onCollapse }: MapPanelProps): ReactNode {
  const { t } = useTranslation()
  return (
    <>
      <div className="cf-panel-head">
        <span className="cf-eyebrow">{t('map.heading')}</span>
        <IconButton icon={PanelRightClose} label={t('map.collapse')} onClick={onCollapse} />
      </div>
      <div className="map-panel__body">
        <p className="empty">{t('map.empty')}</p>
      </div>
    </>
  )
}

interface MapRailProps {
  onExpand(): void
}

export function MapRail({ onExpand }: MapRailProps): ReactNode {
  const { t } = useTranslation()
  return <IconButton icon={PanelRightOpen} label={t('map.expand')} onClick={onExpand} />
}
