import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ELEMENT_NAME_MAX_LENGTH, ELEMENT_TITLE_MAX_LENGTH, isElementName, type CreatedElementKind } from '../../../shared/elements'
import { folderName } from '../components/ExtensionsMenu'
import { FormDialog, useSubmit } from './ElementMenus'

/** An identifier made from a title: lowercase letters and numbers, accents dropped, in words joined by hyphens. */
export const suggestedName = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ELEMENT_NAME_MAX_LENGTH)
    .replace(/-+$/, '')

interface CreateElementDialogProps {
  kind: CreatedElementKind
  /** The displayed Project, which the Created Element belongs to. */
  project: string
  /** Once it is created (it then comes to the front on its own), or the user cancelled. */
  onDone(): void
}

/**
 * The **+** that creates an Element by hand: its title, and the identifier Claude names it by,
 * unique within the Project. The identifier follows the title until the user types one.
 */
export function CreateElementDialog({ kind, project, onDone }: CreateElementDialogProps): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [title, setTitle] = useState('')
  const [typedName, setTypedName] = useState<string | null>(null)
  const name = typedName ?? suggestedName(title)
  const { busy, refusal, send, setRefusal } = useSubmit(onDone)

  const submit = (): void => {
    if (!isElementName(kind, name)) return setRefusal(t('elements.refusal.bad-name'))
    send({ op: 'create', project, kind, name, ...(title.trim() ? { title: title.trim() } : {}) })
  }

  return (
    <FormDialog
      title={t(`elements.create.title.${kind}`)}
      submitLabel={t('elements.create.create')}
      error={refusal}
      busy={busy}
      onSubmit={submit}
      onCancel={onDone}
    >
      <p className="cf-muted element-dialog__lead">{t('elements.create.in', { project: folderName(project) })}</p>
      <label className="element-dialog__field">
        <span>{t('elements.create.titleLabel')}</span>
        <input
          className="extdialog__input"
          value={title}
          maxLength={ELEMENT_TITLE_MAX_LENGTH}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="element-dialog__field">
        <label htmlFor={`${id}-name`}>{t('elements.create.nameLabel')}</label>
        <span className="element-dialog__prefixed">
          <span className="cf-mono element-dialog__prefix" aria-hidden="true">{`${kind}:`}</span>
          <input
            id={`${id}-name`}
            className="cf-mono"
            value={name}
            maxLength={ELEMENT_NAME_MAX_LENGTH}
            spellCheck={false}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </span>
        <span className="extdialog__hint" id={`${id}-hint`}>
          {t('elements.create.nameHint')}
        </span>
      </div>
    </FormDialog>
  )
}
