import type { LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  icon: LucideIcon
  onSelect(): void
  disabled?: boolean
  /** Why the item is disabled, as its tooltip. */
  disabledReason?: string
  danger?: boolean
  /** Draws a separator above the item. */
  separated?: boolean
}

interface MenuProps {
  label: string
  /** Where the menu opens, in viewport pixels: the pointer, or the corner of the button that opened it. */
  at: { x: number; y: number }
  items: MenuItem[]
  onClose(): void
}

/** A popover menu: arrow keys move between items, Escape or a click elsewhere closes it. */
export function Menu({ label, at, items, onClose }: MenuProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(at)

  // Kept inside the window, flipping above or left of the opening point when it would overflow.
  useLayoutEffect(() => {
    const { width, height } = ref.current!.getBoundingClientRect()
    setPosition({
      x: at.x + width > innerWidth ? Math.max(0, at.x - width) : at.x,
      y: at.y + height > innerHeight ? Math.max(0, at.y - height) : at.y
    })
  }, [at])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const closeOutside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose()
      return
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const enabled = [...ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
    enabled[(current + step + enabled.length) % enabled.length]?.focus()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="cf-popover cf-menu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.separated && <hr className="cf-menu__separator" />}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? 'cf-menu__item cf-menu__item--danger' : 'cf-menu__item'}
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <item.icon className="cf-icon" aria-hidden="true" />
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body
  )
}
