import { ChevronDown, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ElementView } from '../../../shared/elements'
import { api } from '../api'
import { ContentItemView, type ItemHandlers } from './ContentItemView'
import { CreateElementDialog } from './ElementMenus'
import { isShown, markSeen, type InterfaceElements } from './interface-elements'

interface TitleBarMenusProps {
  elements: InterfaceElements
  /** The displayed Project, whose menus show. */
  project: string
  onType: ItemHandlers['type']
}

/** The displayed Project's menus in the title bar, in their order, those hidden left out; then the + that creates one. */
export function TitleBarMenus({ elements, project, onType }: TitleBarMenusProps): ReactNode {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const menus = elements.inside('title-bar')
  return (
    <div className="titlebar__menus">
      {menus.filter(isShown).map((element) => (
        <CreatedMenu key={element.id} element={element} elements={elements} siblings={menus} onType={onType} />
      ))}
      <button
        type="button"
        className="cf-btn cf-btn--ghost cf-btn--icon titlebar__new-menu"
        aria-label={t('elements.menuNew')}
        title={t('elements.menuNew')}
        onClick={() => setCreating(true)}
      >
        <Plus className="cf-icon" aria-hidden="true" />
      </button>
      {/* Outside the title bar, whose drag region and colours are not the form's. */}
      {creating && createPortal(<CreateElementDialog kind="menu" project={project} onDone={() => setCreating(false)} />, document.body)}
    </div>
  )
}

interface CreatedMenuProps {
  element: ElementView
  elements: InterfaceElements
  siblings: readonly ElementView[]
  onType: ItemHandlers['type']
}

/** A menu created in the title bar: a button that opens its links and actions. Opening it shows it, so its mark goes. */
function CreatedMenu({ element, elements, siblings, onType }: CreatedMenuProps): ReactNode {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const frame = elements.frame(element, siblings)
  const { id, project, attention } = element
  const title = frame.title ?? id

  // A new menu is on show as soon as it is in the title bar.
  useEffect(() => {
    if (attention === 'front') markSeen(id, project)
  }, [attention, id, project])

  const toggle = (): void => {
    if (!open && attention === 'mark') markSeen(id, project)
    setOpen(!open)
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="cf-btn titlebar__menu"
        data-element={id}
        data-attention={attention ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={frame.style}
        onClick={toggle}
        onContextMenu={frame.onContextMenu}
      >
        {title}
        {attention === 'mark' && <span className="element-mark" aria-hidden="true" />}
        <ChevronDown className="cf-icon cf-icon--sm" aria-hidden="true" />
      </button>
      {open && (
        <MenuPopover element={element} title={title} anchor={button} elements={elements} onType={onType} onClose={close} />
      )}
    </>
  )
}

interface MenuPopoverProps {
  element: ElementView
  title: string
  anchor: RefObject<HTMLButtonElement | null>
  elements: InterfaceElements
  onType: ItemHandlers['type']
  onClose(): void
}

/**
 * A menu's links and actions, under its button: a click on one uses it and closes the menu;
 * Escape, a click elsewhere or leaving the window closes it.
 */
function MenuPopover({ element, title, anchor, elements, onType, onClose }: MenuPopoverProps): ReactNode {
  const { t } = useTranslation()
  const popover = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number }>({ left: 0, top: 0 })

  // Under its button, kept inside the window.
  useLayoutEffect(() => {
    const { left, bottom } = anchor.current!.getBoundingClientRect()
    const { width } = popover.current!.getBoundingClientRect()
    setAt({ left: Math.max(0, Math.min(left, innerWidth - width)), top: bottom + 6 })
  }, [anchor])

  useEffect(() => {
    popover.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!popover.current?.contains(target) && !anchor.current?.contains(target)) onClose()
    }
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      anchor.current?.focus()
    }
  }

  return createPortal(
    <div
      ref={popover}
      role="dialog"
      aria-label={title}
      className="cf-popover element-menu"
      style={{ ...at, ...elements.frame(element).style }}
      onKeyDown={onKeyDown}
    >
      {element.items.length ? (
        <ul className="element-menu__items">
          {element.items.map((item) => (
            // A click on a link or an action uses it, then the menu closes.
            <li key={item.id} onClick={onClose} onContextMenu={(event) => elements.openItemMenu(element, item, event)}>
              <ContentItemView element={element} item={item} onType={onType} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="element-menu__empty">{t('elements.menuEmpty')}</p>
      )}
    </div>,
    document.body
  )
}

/** Restore default layout: the Default layout rule, through the contract; nothing is removed. */
export function RestoreDefaultButton(): ReactNode {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="cf-btn titlebar__restore"
      title={t('elements.restoreDefaultHint')}
      onClick={() => void api.elements.request({ op: 'restore-default' }).catch(() => undefined)}
    >
      <RotateCcw className="cf-icon cf-icon--sm" aria-hidden="true" />
      {t('elements.restoreDefault')}
    </button>
  )
}
