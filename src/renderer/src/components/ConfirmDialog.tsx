import type { LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  /** The question, e.g. "Move this Session to the Recycle Bin?". */
  title: string
  /** What happens and how to undo it. */
  children: ReactNode
  /** Named with the same verb as the title. */
  actionLabel: string
  actionIcon?: LucideIcon
  /** Shown under the body when the action failed, leaving the dialog open. */
  error?: string | null
  /** While the action runs, both buttons wait. */
  busy?: boolean
  onConfirm(): void
  onCancel(): void
}

/**
 * Asks before anything that cannot be undone from inside ClaudeForge, with the action as a danger
 * button. Focus starts on Cancel; Escape cancels, except while the action runs.
 */
export function ConfirmDialog({
  title,
  children,
  actionLabel,
  actionIcon: ActionIcon,
  error,
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): ReactNode {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    cancel.current?.focus()
    return () => element.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="cf-dialog confirm-dialog"
      onCancel={(event) => {
        // Escape: the owner decides whether the dialog goes away.
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 className="cf-dialog__title" id={titleId}>
        {title}
      </h2>
      <div className="confirm-dialog__body" id={bodyId}>
        {children}
      </div>
      {error && (
        <p className="confirm-dialog__error" role="alert">
          {error}
        </p>
      )}
      <div className="cf-dialog__actions">
        <button ref={cancel} type="button" className="cf-btn" disabled={busy} onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
        <button type="button" className="cf-btn cf-btn--danger" disabled={busy} onClick={onConfirm}>
          {ActionIcon && <ActionIcon className="cf-icon" aria-hidden="true" />}
          {actionLabel}
        </button>
      </div>
    </dialog>
  )
}
