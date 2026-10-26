import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface IconButtonProps {
  icon: LucideIcon
  label: string
  /** The tooltip, when it says more than the label. */
  title?: string
  onClick(): void
}

/** A ghost icon button whose label is its accessible name, and its tooltip unless a title says more. */
export function IconButton({ icon: Icon, label, title, onClick }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="cf-btn cf-btn--ghost cf-btn--icon"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
    >
      <Icon className="cf-icon" aria-hidden="true" />
    </button>
  )
}
