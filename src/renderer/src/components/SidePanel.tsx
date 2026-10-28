import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { PANEL_BOUNDS, RAIL_WIDTH, clampPanelWidth, type PanelId, type PanelLayout } from '../../../shared/api'
import { api } from '../api'

const KEY_STEP = 16
const KEY_STEP_LARGE = 64

interface SidePanelProps {
  id: PanelId
  /** Which side of the window the panel sits on; its splitter is on the inner edge. */
  side: 'left' | 'right'
  layout: PanelLayout
  label: string
  resizeLabel: string
  /** Shown instead of the content while the panel is collapsed. */
  rail: ReactNode
  children: ReactNode
  onResizingChange(resizing: boolean): void
  /** Its Element's colours. */
  style?: CSSProperties
  onContextMenu?(event: MouseEvent): void
}

/**
 * A side column that resizes by dragging its inner edge (or with the arrow keys
 * on the focused edge) within its bounds and collapses to a 64px rail. The
 * width is shown live while dragging and written to app state on release.
 */
export function SidePanel(props: SidePanelProps): ReactNode {
  const { id, side, layout, label, resizeLabel, rail, children, onResizingChange, style, onContextMenu } = props
  const { min, max } = PANEL_BOUNDS[id]
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const direction = side === 'left' ? 1 : -1

  const clamp = (width: number): number => clampPanelWidth(id, width)
  const current = liveWidth ?? layout.width

  /** The width the drag gives at this pointer position. */
  const widthAt = (event: PointerEvent<HTMLDivElement>, start: { x: number; width: number }): number =>
    clamp(start.width + (event.clientX - start.x) * direction)

  const commit = (width: number): void => {
    setLiveWidth(width)
    void api.appState.write({ layout: { [id]: { width } } }).finally(() => setLiveWidth(null))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width: layout.width }
    setLiveWidth(layout.width)
    setDragging(true)
    onResizingChange(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    setLiveWidth(widthAt(event, drag.current))
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const width = widthAt(event, drag.current)
    drag.current = null
    setDragging(false)
    onResizingChange(false)
    commit(width)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    let width: number
    if (event.key === 'ArrowRight') width = current + step * direction
    else if (event.key === 'ArrowLeft') width = current - step * direction
    else if (event.key === 'Home') width = min
    else if (event.key === 'End') width = max
    else return
    event.preventDefault()
    commit(clamp(width))
  }

  return (
    <aside
      className={`side-panel side-panel--${side}`}
      aria-label={label}
      data-panel={id}
      data-collapsed={layout.collapsed}
      data-colored={style?.background !== undefined || undefined}
      style={{ ...style, width: layout.collapsed ? RAIL_WIDTH : current }}
      onContextMenu={onContextMenu}
    >
      {layout.collapsed ? (
        <div className="rail">{rail}</div>
      ) : (
        <>
          <div className="side-panel__body">{children}</div>
          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeLabel}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={current}
            tabIndex={0}
            data-dragging={dragging}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          />
        </>
      )}
    </aside>
  )
}
