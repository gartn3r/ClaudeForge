import { Check, CircleAlert, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { BacklogChoices, BacklogConfig, WorkItem, WorkItemAction, WorkItemListing } from '../../../shared/api'
import {
  ACTION_COLOURS,
  ACTION_LABEL_MAX_LENGTH,
  LIME,
  MAX_WORK_ITEM_ACTIONS,
  PLACEHOLDERS,
  actionCommand,
  actionProblems,
  backlogConfigured,
  isBlankAction,
  organizationUrl,
  textOn,
  tidyBacklogConfig,
  workItemUrl,
  type ActionProblem
} from '../../../shared/work-items'
import { api } from '../api'
import { folderName, useExtensions } from './ExtensionsMenu'
import { skillChoices, skillCommandName } from './Shortcuts'
import { actionStyle, backlogFailure, shortDay } from './WorkItems'

/** How long the form waits after the organisation is typed before asking `az` for its projects. */
const TYPING_PAUSE_MS = 600

const blankAction = (): WorkItemAction => ({ id: crypto.randomUUID(), label: '', skill: '', text: '', colour: 'outline' })

/** Options read from `az` for one field: none asked yet, being read, or its answer. */
type Choices = BacklogChoices | 'reading' | null

/**
 * Reads one field's options from `az` (`projects` of an organisation, `areas` or `iterationRoots` of
 * a project) whenever what they depend on changes; nothing while a value they need is blank.
 */
function useChoices(kind: 'projects' | 'areas' | 'iterationRoots', organization: string, project = ''): Choices {
  const [choices, setChoices] = useState<{ key: string; value: Choices } | null>(null)
  const needed = !!organization && (kind === 'projects' || !!project)
  const key = `${organization} ${project}`
  useEffect(() => {
    if (!needed) return
    let current = true
    const asked = kind === 'projects' ? api.backlog.projects(organization) : api.backlog[kind](organization, project)
    void asked.catch(backlogFailure).then((value) => current && setChoices({ key, value }))
    return () => {
      current = false
    }
  }, [kind, needed, key, organization, project])
  if (!needed) return null
  return choices?.key === key ? choices.value : 'reading'
}

/** A value after a pause in its changes, so typing does not ask `az` at every key. */
function usePaused(value: string): string {
  const [paused, setPaused] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setPaused(value), TYPING_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return paused
}

interface WorkItemsDialogProps {
  config: BacklogConfig | null
  actions: WorkItemAction[]
  /** The displayed Project, whose skills the form offers and checks. */
  project: string
  /** A Work item the previews fill the placeholders with, until a test finds one; a sample one when the card lists none. */
  sample: WorkItem | null
  onDone(): void
}

/**
 * The Work items card's configuration: where the backlog is read (an organisation, then a project,
 * an area path and an iteration root chosen among what `az` lists), a test of it, and the one to
 * three Work item actions. The same for every Project.
 */
export function WorkItemsDialog({ config, actions: savedActions, project, sample, onDone }: WorkItemsDialogProps): ReactNode {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [organization, setOrganization] = useState(config?.organization ?? '')
  const [azProject, setAzProject] = useState(config?.project ?? '')
  const [areaPath, setAreaPath] = useState(config?.areaPath ?? '')
  const [iterationRoot, setIterationRoot] = useState(config?.iterationRoot ?? '')
  const [actions, setActions] = useState<WorkItemAction[]>(savedActions.length ? savedActions : [blankAction()])
  /** The last test, for the fields as they were then: it no longer shows once they change. */
  const [tested, setTested] = useState<{ key: string; value: WorkItemListing | 'testing' } | null>(null)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const draft = tidyBacklogConfig({ organization, project: azProject, areaPath, iterationRoot })
  const org = organizationUrl(usePaused(organization))
  const projects = useChoices('projects', org)
  const areas = useChoices('areas', org, azProject)
  const roots = useChoices('iterationRoots', org, azProject)
  const draftKey = JSON.stringify(draft)
  const test = tested?.key === draftKey ? tested.value : null
  const runTest = (): void => {
    setTested({ key: draftKey, value: 'testing' })
    void api.backlog
      .workItems(draft)
      .catch(backlogFailure)
      .then((value) => setTested((each) => (each?.key === draftKey ? { key: draftKey, value } : each)))
  }

  const { listing } = useExtensions(project)
  const projectSkills =
    typeof listing === 'object' ? new Set(listing.extensions.filter((each) => each.kind === 'skill').map(skillCommandName)) : null
  // The first Work item a test found, else the card's, else a sample one.
  const found = typeof test === 'object' && test?.ok ? test.workItems[0] : undefined
  const preview: WorkItem = found ?? sample ?? { id: 12345, type: 'Product Backlog Item', state: 'To Do', title: t('workItems.dialog.sample'), assignedToMe: false }
  const previewUrl = workItemUrl(draft, preview.id)

  const blank = !organization.trim() && !azProject && !areaPath && !iterationRoot
  const incomplete = !blank && !backlogConfigured(draft)
  const problemsOf = (action: WorkItemAction): ActionProblem[] =>
    isBlankAction(action) ? [] : actionProblems(action).filter((problem) => tried || problem === 'text-forbidden')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setTried(true)
    if (incomplete || actions.some((action) => !isBlankAction(action) && actionProblems(action).length)) return
    void api.appState
      .write({ backlog: blank ? null : draft, workItemActions: actions.filter((action) => !isBlankAction(action)) })
      .finally(onDone)
  }

  const change = (index: number, fields: Partial<WorkItemAction>): void =>
    setActions((each) => each.map((action, at) => (at === index ? { ...action, ...fields } : action)))

  return (
    <dialog
      ref={dialog}
      className="cf-dialog shortcut-dialog work-items-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        onDone()
      }}
    >
      <form className="shortcut-dialog__form" noValidate onSubmit={submit}>
        <div className="shortcut-dialog__head work-items-dialog__head">
          <h2 className="cf-dialog__title" id={`${id}-title`}>
            {t('workItems.dialog.title')}
          </h2>
          <button
            type="button"
            className="cf-btn cf-btn--icon"
            aria-label={t('dialog.close')}
            title={t('dialog.close')}
            onClick={onDone}
          >
            <X className="cf-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="shortcut-dialog__body">
          <section className="work-items-dialog__section" aria-labelledby={`${id}-backlog`}>
            <h3 className="cf-eyebrow" id={`${id}-backlog`}>
              {t('workItems.dialog.backlog')}
            </h3>
            <div className="work-items-dialog__pair">
              <label className="shortcut-dialog__field">
                <span>{t('workItems.dialog.organization')}</span>
                <input
                  className="extdialog__input cf-mono"
                  value={organization}
                  spellCheck={false}
                  autoFocus
                  aria-invalid={(tried && incomplete && !/^https?:[/][/]\S+$/i.test(draft.organization)) || undefined}
                  onChange={(event) => {
                    // Another organisation has projects, areas and iterations of its own.
                    if (organizationUrl(event.target.value) !== organizationUrl(organization)) {
                      setAzProject('')
                      setAreaPath('')
                      setIterationRoot('')
                    }
                    setOrganization(event.target.value)
                  }}
                  onBlur={(event) => setOrganization(organizationUrl(event.target.value))}
                />
                <span className="extdialog__hint">{t('workItems.dialog.organizationHint')}</span>
              </label>
              <ChoiceField
                label={t('workItems.dialog.project')}
                value={azProject}
                choices={projects}
                invalid={tried && incomplete && !azProject}
                onChange={(value) => {
                  setAzProject(value)
                  if (value !== azProject) {
                    setAreaPath('')
                    setIterationRoot('')
                  }
                }}
              />
            </div>
            <ChoiceField
              label={t('workItems.dialog.areaPath')}
              hint={t('workItems.dialog.areaHint')}
              value={areaPath}
              choices={areas}
              mono
              invalid={tried && incomplete && !areaPath}
              onChange={setAreaPath}
            />
            <ChoiceField
              label={t('workItems.dialog.iterationRoot')}
              hint={t('workItems.dialog.iterationHint')}
              value={iterationRoot}
              choices={roots}
              mono
              invalid={tried && incomplete && !iterationRoot}
              onChange={setIterationRoot}
            />
            <div className="work-items-dialog__test">
              <button type="button" className="cf-btn" disabled={!backlogConfigured(draft) || test === 'testing'} onClick={runTest}>
                {test === 'testing' ? t('workItems.dialog.testing') : t('workItems.dialog.test')}
              </button>
              {test && test !== 'testing' && <TestResult result={test} />}
            </div>
            {tried && incomplete && (
              <p className="shortcut-dialog__errors" role="alert">
                {t('workItems.dialog.incomplete')}
              </p>
            )}
          </section>

          <section className="work-items-dialog__section" aria-labelledby={`${id}-actions`}>
            <div className="work-items-dialog__actions-head">
              <h3 className="cf-eyebrow" id={`${id}-actions`}>
                {t('workItems.dialog.actions')}
              </h3>
              <span className="cf-muted">{t('workItems.dialog.count', { count: actions.length, max: MAX_WORK_ITEM_ACTIONS })}</span>
            </div>
            <p className="extdialog__hint work-items-dialog__lead">{t('workItems.dialog.actionsLead')}</p>
            {actions.map((action, index) => (
              <ActionEditor
                key={action.id}
                action={action}
                index={index}
                project={project}
                listing={listing}
                projectSkills={projectSkills}
                problems={problemsOf(action)}
                preview={actionCommand(action, preview, previewUrl)}
                previewId={preview.id}
                removable={actions.length > 1}
                onChange={(fields) => change(index, fields)}
                onRemove={() => setActions((each) => each.filter((_, at) => at !== index))}
              />
            ))}
            {actions.length < MAX_WORK_ITEM_ACTIONS && (
              <button
                type="button"
                className="cf-btn work-items-dialog__add"
                onClick={() => setActions((each) => [...each, blankAction()])}
              >
                <Plus className="cf-icon" aria-hidden="true" />
                {t('workItems.dialog.add')}
              </button>
            )}
          </section>
        </div>
        <div className="cf-dialog__actions">
          <button type="button" className="cf-btn" onClick={onDone}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="cf-btn cf-btn--primary">
            {t('workItems.dialog.save')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

interface ChoiceFieldProps {
  label: string
  hint?: string
  value: string
  choices: Choices
  mono?: boolean
  invalid: boolean
  onChange(value: string): void
}

/** A field chosen among what `az` lists; the value already set stays on offer, and why `az` could not list them shows below. */
function ChoiceField({ label, hint, value, choices, mono, invalid, onChange }: ChoiceFieldProps): ReactNode {
  const { t } = useTranslation()
  const values = typeof choices === 'object' && choices?.ok ? choices.values : []
  const options = value && !values.includes(value) ? [value, ...values] : values
  return (
    <label className="shortcut-dialog__field">
      <span>{label}</span>
      <select
        className={`extdialog__input${mono ? ' cf-mono' : ''}`}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {choices === 'reading' ? t('workItems.dialog.reading') : t('workItems.dialog.choose')}
        </option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {typeof choices === 'object' && choices && !choices.ok ? (
        <span className="extdialog__hint work-items-dialog__failure">
          {t(`workItems.problem.${choices.problem}`)} {choices.detail}
        </span>
      ) : (
        hint && <span className="extdialog__hint">{hint}</span>
      )}
    </label>
  )
}

/** What a test of the configuration found: the sprint, its dates and its Work items, or why there are none. */
function TestResult({ result }: { result: WorkItemListing }): ReactNode {
  const { t } = useTranslation()
  if (!result.ok) {
    return (
      <p className="work-items-dialog__result work-items-dialog__result--failed" role="status">
        <CircleAlert className="cf-icon" aria-hidden="true" />
        <span>
          <strong>{t(`workItems.problem.${result.problem}`)}</strong> {result.detail}
        </span>
      </p>
    )
  }
  const mine = result.workItems.filter((workItem) => workItem.assignedToMe).length
  return (
    <p className="work-items-dialog__result" role="status">
      <Check className="cf-icon" aria-hidden="true" />
      <span>
        {result.sprint ? (
          <Trans
            i18nKey="workItems.dialog.testResult"
            values={{
              name: result.sprint.name,
              start: shortDay(result.sprint.start),
              finish: shortDay(result.sprint.finish),
              count: result.workItems.length,
              mine,
              unassigned: result.workItems.length - mine
            }}
            components={{ b: <strong /> }}
          />
        ) : (
          t('workItems.dialog.testNoSprint')
        )}
      </span>
    </p>
  )
}

/** The colours offered to the second and third actions, in order, beside outline and any other. */
const PRESETS = Object.entries(ACTION_COLOURS) as Array<[keyof typeof ACTION_COLOURS, string]>

interface ActionEditorProps {
  action: WorkItemAction
  index: number
  project: string
  listing: ReturnType<typeof useExtensions>['listing']
  projectSkills: ReadonlySet<string> | null
  problems: ActionProblem[]
  preview: string
  previewId: number
  removable: boolean
  onChange(fields: Partial<WorkItemAction>): void
  onRemove(): void
}

/** One Work item action: its label, skill and text with placeholders, a preview of its command, and for the second and third, their colour. */
function ActionEditor(props: ActionEditorProps): ReactNode {
  const { action, index, project, listing, projectSkills, problems, preview, previewId, removable, onChange, onRemove } = props
  const { t } = useTranslation()
  const id = useId()
  const text = useRef<HTMLInputElement>(null)
  const custom = useRef<HTMLInputElement>(null)
  const skills = skillChoices(listing, action.skill, t)
  const missing = !!action.skill && projectSkills !== null && !projectSkills.has(action.skill)
  const isPreset = action.colour === 'outline' || PRESETS.some(([, hex]) => hex === action.colour)

  /** Puts a placeholder where the text's cursor is, then the cursor after it. */
  const insert = (placeholder: string): void => {
    const input = text.current!
    const start = input.selectionStart ?? action.text.length
    const end = input.selectionEnd ?? start
    onChange({ text: action.text.slice(0, start) + placeholder + action.text.slice(end) })
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + placeholder.length, start + placeholder.length)
    })
  }

  return (
    <fieldset className="work-items-dialog__action" aria-label={t('workItems.dialog.actions') + ` ${index + 1}`}>
      <div className="work-items-dialog__action-head">
        <span className="work-items-dialog__number">{index + 1}</span>
        <span className="cf-muted">{index === 0 ? t('workItems.dialog.primary') : ''}</span>
        {removable && (
          <button
            type="button"
            className="cf-btn cf-btn--icon"
            aria-label={t('workItems.dialog.remove', { n: index + 1 })}
            title={t('workItems.dialog.remove', { n: index + 1 })}
            onClick={onRemove}
          >
            <Trash2 className="cf-icon" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="work-items-dialog__pair">
        <label className="shortcut-dialog__field">
          <span>{t('workItems.dialog.label')}</span>
          <input
            className="extdialog__input"
            value={action.label}
            maxLength={ACTION_LABEL_MAX_LENGTH}
            aria-invalid={problems.includes('label-missing') || undefined}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
        <label className="shortcut-dialog__field">
          <span>{t('workItems.dialog.skill')}</span>
          <select
            className="extdialog__input"
            value={action.skill}
            aria-invalid={problems.includes('skill-missing') || undefined}
            onChange={(event) => onChange({ skill: event.target.value })}
          >
            <option value="" disabled>
              {t('workItems.dialog.choose')}
            </option>
            {skills.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {typeof listing === 'object' && skills.length === 0 && (
        <p className="extdialog__hint">{t('shortcuts.form.noSkills', { project: folderName(project) })}</p>
      )}
      <label className="shortcut-dialog__field">
        <span>{t('workItems.dialog.text')}</span>
        <input
          ref={text}
          className="extdialog__input cf-mono"
          value={action.text}
          placeholder="#{id} {title}"
          spellCheck={false}
          aria-invalid={problems.includes('text-forbidden') || undefined}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </label>
      <div className="work-items-dialog__insert" role="group" aria-label={t('workItems.dialog.insert')}>
        <span className="cf-muted">{t('workItems.dialog.insert')}</span>
        {PLACEHOLDERS.map((placeholder) => (
          <button key={placeholder} type="button" className="cf-chip cf-mono" onClick={() => insert(placeholder)}>
            {placeholder}
          </button>
        ))}
      </div>
      <div className="shortcut-dialog__preview cf-on-slate">
        <span className="shortcut-dialog__preview-label">{t('workItems.dialog.preview', { id: previewId })}</span>
        <code className="cf-mono">{`> ${preview}`}</code>
      </div>
      {index > 0 && (
        <div className="work-items-dialog__colours" role="group" aria-labelledby={`${id}-colour`}>
          <span className="work-items-dialog__colour-label" id={`${id}-colour`}>
            {t('workItems.dialog.colour')}
          </span>
          <div className="work-items-dialog__swatches">
            <button
              type="button"
              className="work-items-dialog__swatch work-items-dialog__swatch--outline"
              aria-label={t('workItems.dialog.colours.outline')}
              title={t('workItems.dialog.colours.outline')}
              aria-pressed={action.colour === 'outline'}
              onClick={() => onChange({ colour: 'outline' })}
            />
            {PRESETS.map(([name, hex]) => (
              <button
                key={name}
                type="button"
                className="work-items-dialog__swatch"
                style={{ background: name === 'slate' ? 'var(--action-slate)' : hex }}
                aria-label={t(`workItems.dialog.colours.${name}`)}
                title={t(`workItems.dialog.colours.${name}`)}
                aria-pressed={action.colour === hex}
                onClick={() => onChange({ colour: hex })}
              />
            ))}
            <button
              type="button"
              className="work-items-dialog__other"
              aria-pressed={!isPreset}
              style={isPreset ? undefined : { background: action.colour, color: textOn(action.colour), borderStyle: 'solid' }}
              onClick={() => custom.current?.click()}
            >
              {t('workItems.dialog.colours.other')}
            </button>
            <input
              ref={custom}
              type="color"
              className="work-items-dialog__picker"
              tabIndex={-1}
              aria-hidden="true"
              value={action.colour === 'outline' ? '#8fb3d9' : action.colour}
              // Lime stays the first action's.
              onChange={(event) => onChange({ colour: event.target.value.toLowerCase() === LIME ? 'outline' : event.target.value })}
            />
            <span className="work-items-dialog__colour-preview">
              <span className="cf-muted">{t('workItems.dialog.colourPreview')}</span>
              <span className="work-item__action" style={actionStyle(action, index)}>
                {action.label || t('workItems.dialog.label')}
              </span>
            </span>
          </div>
          <span className="extdialog__hint">{t('workItems.dialog.colourHint')}</span>
        </div>
      )}
      {missing && (
        <p className="work-items-dialog__warning">
          <CircleAlert className="cf-icon" aria-hidden="true" />
          <span>
            <strong>{t('workItems.dialog.missingSkill', { project: folderName(project) })}</strong> {t('workItems.dialog.missingSkillHint')}
          </span>
        </p>
      )}
      {problems.length > 0 && (
        <ul className="shortcut-dialog__errors" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{t(`workItems.dialog.${problem}`)}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
