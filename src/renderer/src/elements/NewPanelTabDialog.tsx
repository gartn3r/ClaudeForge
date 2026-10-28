import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ELEMENT_NAME_MAX_LENGTH, ELEMENT_TITLE_MAX_LENGTH, isElementName } from '../../../shared/elements'
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

interface NewPanelTabDialogProps {
  /** The displayed Project, which the Panel tab belongs to. */
  project: string
  /** Once it is created (it then comes to the front on its own), or the user cancelled. */
  onDone(): void
}

const KIND = 'panel-tab'

/**
 * The Right panel's **+**: a Panel tab's title, and the identifier Claude names it by, unique within
 * the Project. The identifier follows the title until the user types one.
 */
export function NewPanelTabDialog({ project, onDone }: NewPanelTabDialogProps): ReactNode {
  const { t } = useTranslation()
  const id = useId()
  const [title, setTitle] = useState('')
  const [typedName, setTypedName] = useState<string | null>(null)
  const name = typedName ?? suggestedName(title)
  const { busy, refusal, send, setRefusal } = useSubmit(onDone)

  const submit = (): void => {
    if (!isElementName(KIND, name)) return setRefusal(t('elements.refusal.bad-name'))
    send({ op: 'create', project, kind: KIND, name, ...(title.trim() ? { title: title.trim() } : {}) })
  }

  return (
    <FormDialog
      title={t('rightPanel.create.title')}
      submitLabel={t('rightPanel.create.create')}
      error={refusal}
      busy={busy}
      onSubmit={submit}
      onCancel={onDone}
    >
      <p className="cf-muted element-dialog__lead">{t('rightPanel.create.in', { project: folderName(project) })}</p>
      <label className="element-dialog__field">
        <span>{t('rightPanel.create.titleLabel')}</span>
        <input
          className="extdialog__input"
          value={title}
          maxLength={ELEMENT_TITLE_MAX_LENGTH}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="element-dialog__field">
        <label htmlFor={`${id}-name`}>{t('rightPanel.create.nameLabel')}</label>
        <span className="element-dialog__prefixed">
          <span className="cf-mono element-dialog__prefix" aria-hidden="true">{`${KIND}:`}</span>
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
          {t('rightPanel.create.nameHint')}
        </span>
      </div>
    </FormDialog>
  )
}
