import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface IconButtonProps {
  icon: LucideIcon
  label: string
  onClick(): void
}

/** A ghost icon button whose label is its accessible name and tooltip. */
export function IconButton({ icon: Icon, label, onClick }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="cf-btn cf-btn--ghost cf-btn--icon"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon className="cf-icon" aria-hidden="true" />
    </button>
  )
}
