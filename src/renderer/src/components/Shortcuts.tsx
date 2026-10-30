import { Globe, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { Extension, Shortcut, ShortcutCommand } from '../../../shared/api'
import { SHORTCUT_NAME_MAX_LENGTH, commandText, shortcutProblems, type ShortcutProblem } from '../../../shared/shortcuts'
import { api } from '../api'
import type { ElementFrame } from '../elements/interface-elements'
import { folderName, useExtensions } from './ExtensionsMenu'
import { Menu } from './Menu'

/** How Claude Code names a skill in its prompt: a plugin's as `<plugin>:<skill>`. */
export const skillCommandName = (skill: Extension): string => (skill.plugin ? `${skill.plugin}:${skill.name}` : skill.name)

/**
 * The skills a Project's Sessions get, by the name Claude Code types them with; null while they are
 * read, when they could not be, or when no Shortcut needs them (`project` null), so nothing lists them.
 */
export function useProjectSkills(project: string | null): ReadonlySet<string> | null {
  const { listing } = useExtensions(project)
  if (typeof listing !== 'object') return null
  return new Set(listing.extensions.filter((extension) => extension.kind === 'skill').map(skillCommandName))
}

/** A Skill shortcut that names a skill the target Project lacks: greyed out, it types nothing. Freely written commands never are. */
export const lacksSkill = (shortcut: Shortcut, skills: ReadonlySet<string> | null): boolean =>
  shortcut.kind === 'skill' && shortcut.command.mode === 'skill' && skills !== null && !skills.has(shortcut.command.skill)

/** What a Shortcut's row says under its name: the command it types, or where its page is. */
function detailOf(shortcut: Shortcut): string {
  if (shortcut.kind === 'skill') return commandText(shortcut.command)
  try {
    const url = new URL(shortcut.address)
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname.split('/').pop() ?? '') || shortcut.address : url.host
  } catch {
    return shortcut.address
  }
}

/** A Shortcut's initials on the collapsed explorer's rail: its first and last words', "Move the Map" as "MM". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = (word: string | undefined): string => (word ? Array.from(word)[0]!.toLocaleUpperCase() : '')
  return words.length > 1 ? first(words[0]) + first(words.at(-1)) : first(words[0])
}

/** Writes the Shortcuts, in order; the app state pushes them back once stored. */
const saveShortcuts = (shortcuts: Shortcut[]): Promise<unknown> => api.appState.write({ shortcuts })

interface ShortcutsCardProps {
  shortcuts: Shortcut[]
  /** The Project a Skill shortcut's command would go to, which names the greyed ones' tooltip. */
  target: string
  /** The target Project's skills, by the name Claude Code types them with; null while unknown. */
  skills: ReadonlySet<string> | null
  /** The Web shortcut whose Web tab is on show, by id; null when none is. */
  shownWebShortcut: string | null
  onOpen(shortcut: Shortcut): void
  onAdd(): void
  onEdit(shortcut: Shortcut): void
  /** What it takes from its Element: its title, collapsed state, colours and right-click menu. */
  frame?: ElementFrame
}

/**
 * The Shortcuts card, above the Sessions: the user's Web and Skill shortcuts, in their order, the
 * same for every Project. Each opens on a click; its menu edits or deletes it; a drag moves it.
 */
export function ShortcutsCard(props: ShortcutsCardProps): ReactNode {
  const { shortcuts, target, skills, shownWebShortcut, onOpen, onAdd, onEdit, frame } = props
  const { t } = useTranslation()
  const headingId = useId()
  const [menu, setMenu] = useState<{ shortcut: Shortcut; at: { x: number; y: number } } | null>(null)
  /** The Shortcut being dragged, and where it would land: before the Shortcut at that index. */
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null)

  const move = (id: string, to: number): void => {
    const from = shortcuts.findIndex((shortcut) => shortcut.id === id)
    if (from < 0 || to === from || to === from + 1) return
    const next = [...shortcuts]
    const [moved] = next.splice(from, 1)
    next.splice(to > from ? to - 1 : to, 0, moved!)
    void saveShortcuts(next)
  }

  // Dropped on a row's upper half, a Shortcut lands before it; on its lower half, after it.
  const landingAt = (event: DragEvent<HTMLElement>, index: number): number => {
    const { top, height } = event.currentTarget.getBoundingClientRect()
    return event.clientY < top + height / 2 ? index : index + 1
  }

  return (
    <section
      className="shortcuts cf-tile cf-tile--card"
      aria-labelledby={headingId}
      data-element={frame?.id}
      style={frame?.style}
      onContextMenu={frame?.onContextMenu}
      {...frame?.dropZone}
    >
      <div className="shortcuts__head" {...frame?.grip}>
        <h2 className="cf-heading" id={headingId}>
          {frame?.title ?? t('shortcuts.heading')}
        </h2>
        <button
          type="button"
          className="cf-btn cf-btn--add cf-btn--icon"
          aria-label={t('shortcuts.add')}
          title={t('shortcuts.add')}
          onClick={onAdd}
        >
          <Plus className="cf-icon" aria-hidden="true" />
        </button>
      </div>
      {shortcuts.length > 0 && !frame?.collapsed && (
        <ul className="shortcuts__list" aria-label={t('shortcuts.label')}>
          {shortcuts.map((shortcut, index) => {
            const missing = lacksSkill(shortcut, skills)
            const missingId = `${headingId}-missing-${shortcut.id}`
            const detailId = `${headingId}-detail-${shortcut.id}`
            const classes = [
              'shortcuts__row',
              shortcut.kind === 'web' && shownWebShortcut === shortcut.id && 'shortcuts__row--shown',
              missing && 'shortcuts__row--missing',
              drag?.id === shortcut.id && 'shortcuts__row--dragged',
              drag?.over === index && 'shortcuts__row--drop-before',
              drag?.over === index + 1 && index === shortcuts.length - 1 && 'shortcuts__row--drop-after'
            ].filter(Boolean)
            return (
              <li
                key={shortcut.id}
                className={classes.join(' ')}
                draggable
                data-shortcut={shortcut.id}
                title={missing ? t('shortcuts.missingSkill', { project: folderName(target) }) : undefined}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', shortcut.name)
                  setDrag({ id: shortcut.id, over: null })
                }}
                onDragOver={(event) => {
                  if (!drag) return
                  event.preventDefault()
                  const over = landingAt(event, index)
                  if (over !== drag.over) setDrag({ ...drag, over })
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (drag) move(drag.id, landingAt(event, index))
                  setDrag(null)
                }}
                onDragEnd={() => setDrag(null)}
              >
                <span className={`shortcuts__mark shortcuts__mark--${shortcut.kind}`} aria-hidden="true">
                  {shortcut.kind === 'web' ? <Globe className="cf-icon cf-icon--sm" /> : '/'}
                </span>
                <button
                  type="button"
                  className="shortcuts__open"
                  aria-label={shortcut.name}
                  aria-disabled={missing || undefined}
                  aria-describedby={missing ? missingId : detailId}
                  onClick={() => !missing && onOpen(shortcut)}
                >
                  <span className="shortcuts__name">{shortcut.name}</span>
                  <span id={detailId} className={`shortcuts__detail${shortcut.kind === 'skill' ? ' cf-mono' : ''}`}>
                    {detailOf(shortcut)}
                  </span>
                </button>
                {missing && (
                  <span hidden id={missingId}>
                    {t('shortcuts.missingSkill', { project: folderName(target) })}
                  </span>
                )}
                <button
                  type="button"
                  className="cf-btn cf-btn--ghost cf-btn--icon shortcuts__actions"
                  aria-label={t('shortcuts.actions')}
                  aria-haspopup="menu"
                  aria-expanded={menu?.shortcut.id === shortcut.id}
                  title={t('shortcuts.actions')}
                  onClick={(event) => {
                    const { left, bottom } = event.currentTarget.getBoundingClientRect()
                    setMenu({ shortcut, at: { x: left, y: bottom } })
                  }}
                >
                  <MoreHorizontal className="cf-icon" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {menu && (
        <Menu
          label={t('shortcuts.actions')}
          at={menu.at}
          items={[
            { label: t('shortcuts.edit'), icon: Pencil, onSelect: () => onEdit(menu.shortcut) },
            {
              label: t('shortcuts.delete'),
              icon: Trash2,
              danger: true,
              onSelect: () => void saveShortcuts(shortcuts.filter((shortcut) => shortcut.id !== menu.shortcut.id))
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  )
}

interface ShortcutsRailProps {
  shortcuts: Shortcut[]
  target: string
  skills: ReadonlySet<string> | null
  onOpen(shortcut: Shortcut): void
  onAdd(): void
}

/** The Shortcuts on the collapsed explorer's rail: each by its initials, its name as its tooltip, and the "+". */
export function ShortcutsRail({ shortcuts, target, skills, onOpen, onAdd }: ShortcutsRailProps): ReactNode {
  const { t } = useTranslation()
  return (
    <div className="shortcuts-rail" role="group" aria-label={t('shortcuts.label')}>
      {shortcuts.map((shortcut) => {
        const missing = lacksSkill(shortcut, skills)
        return (
          <button
            key={shortcut.id}
            type="button"
            className={`shortcuts-rail__item shortcuts-rail__item--${shortcut.kind}`}
            aria-label={shortcut.name}
            aria-disabled={missing || undefined}
            title={missing ? `${shortcut.name} · ${t('shortcuts.missingSkill', { project: folderName(target) })}` : `${shortcut.name} · ${detailOf(shortcut)}`}
            onClick={() => !missing && onOpen(shortcut)}
          >
            {initialsOf(shortcut.name)}
          </button>
        )
      })}
      <button
        type="button"
        className="cf-btn cf-btn--add shortcuts-rail__add"
        aria-label={t('shortcuts.add')}
        title={t('shortcuts.add')}
        onClick={onAdd}
      >
        <Plus className="cf-icon" aria-hidden="true" />
      </button>
    </div>
  )
}

/** How the Shortcut form shows a skill: by Claude Code's name for it, and where it comes from. */
export interface SkillChoice {
  value: string
  label: string
}

/**
 * The skills a form offers from a Project's Extensions: the Project's own first, then the user's,
 * then the plugins'. A skill already chosen that the Project lacks stays on offer, first, so editing keeps it.
 */
export function skillChoices(
  listing: ReturnType<typeof useExtensions>['listing'],
  chosen: string,
  t: ReturnType<typeof useTranslation>['t']
): SkillChoice[] {
  const rank = (skill: Extension): number => (skill.plugin ? 2 : skill.scope === 'project' ? 0 : 1)
  const skills: SkillChoice[] =
    typeof listing === 'object'
      ? listing.extensions
          .filter((extension) => extension.kind === 'skill')
          .sort((a, b) => rank(a) - rank(b))
          .map((extension) => ({
            value: skillCommandName(extension),
            label: t('shortcuts.form.skillOption', {
              name: extension.name,
              origin: extension.plugin ?? t(`extensions.origin.${extension.scope}`)
            })
          }))
      : []
  if (chosen && !skills.some((choice) => choice.value === chosen)) skills.unshift({ value: chosen, label: chosen })
  return skills
}

interface ShortcutDialogProps {
  /** The Shortcut to edit; none for a new one. */
  editing: Shortcut | null
  shortcuts: Shortcut[]
  /** The displayed Project, whose skills (and the user's) the form offers. */
  project: string
  onDone(): void
}

const PROBLEM_KEYS = {
  'name-missing': 'shortcuts.form.nameMissing',
  'address-invalid': 'shortcuts.form.addressInvalid',
  'command-missing': 'shortcuts.form.commandMissing',
  'command-forbidden': 'shortcuts.form.commandForbidden'
} as const satisfies Record<ShortcutProblem, string>

/**
 * The form that adds a Shortcut or edits one: a name, then a web address, or a command typed into
 * a Session (a skill among the Extensions with its arguments, or one written freely). It refuses
 * what the app state would not keep, saying why.
 */
export function ShortcutDialog({ editing, shortcuts, project, onDone }: ShortcutDialogProps): ReactNode {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const { listing } = useExtensions(project)
  const [kind, setKind] = useState<Shortcut['kind']>(editing?.kind ?? 'web')
  const [name, setName] = useState(editing?.name ?? '')
  const [address, setAddress] = useState(editing?.kind === 'web' ? editing.address : '')
  const initial: ShortcutCommand | null = editing?.kind === 'skill' ? editing.command : null
  const [mode, setMode] = useState<ShortcutCommand['mode']>(initial?.mode ?? 'skill')
  const [skill, setSkill] = useState(initial?.mode === 'skill' ? initial.skill : '')
  const [args, setArgs] = useState(initial?.mode === 'skill' ? initial.args : '')
  const [text, setText] = useState(initial?.mode === 'free' ? initial.text : '')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const skills = skillChoices(listing, skill, t)
  const chosenSkill = skill || skills[0]?.value || ''

  const command: ShortcutCommand = mode === 'skill' ? { mode, skill: chosenSkill, args } : { mode, text }
  const shortcut: Shortcut =
    kind === 'web'
      ? { id: editing?.id ?? crypto.randomUUID(), name, kind, address }
      : { id: editing?.id ?? crypto.randomUUID(), name, kind, command }
  const problems = shortcutProblems(shortcut)
  // A forbidden character is said as soon as it is typed; what is missing, once the user tries to add.
  const shown = problems.filter((problem) => tried || problem === 'command-forbidden')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setTried(true)
    if (problems.length) return
    const next = editing ? shortcuts.map((each) => (each.id === editing.id ? shortcut : each)) : [...shortcuts, shortcut]
    void saveShortcuts(next).finally(onDone)
  }

  const errorId = `${id}-errors`
  const invalid = (problem: ShortcutProblem): boolean | undefined => shown.includes(problem) || undefined
  const title = editing ? t('shortcuts.form.titleEdit') : t('shortcuts.form.titleNew')

  return (
    <dialog
      ref={dialog}
      className="cf-dialog shortcut-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        onDone()
      }}
    >
      <form className="shortcut-dialog__form" noValidate onSubmit={submit}>
        <div className="shortcut-dialog__head">
          <h2 className="cf-dialog__title" id={`${id}-title`}>
            {title}
          </h2>
          <p className="cf-muted">{t('shortcuts.form.lead')}</p>
        </div>
        <div className="shortcut-dialog__body">
          <div className="cf-seg shortcut-dialog__kind" role="group" aria-label={t('shortcuts.form.kind')}>
            {(['web', 'skill'] as const).map((each) => (
              <button key={each} type="button" aria-pressed={kind === each} onClick={() => setKind(each)}>
                {t(`shortcuts.form.${each}`)}
              </button>
            ))}
          </div>

          <label className="shortcut-dialog__field">
            <span>{t('shortcuts.form.name')}</span>
            <input
              className="extdialog__input"
              value={name}
              maxLength={SHORTCUT_NAME_MAX_LENGTH}
              required
              autoFocus
              aria-invalid={invalid('name-missing')}
              aria-errormessage={errorId}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {kind === 'web' ? (
            <div className="shortcut-dialog__field">
              <label htmlFor={`${id}-address`}>{t('shortcuts.form.address')}</label>
              <input
                id={`${id}-address`}
                className="extdialog__input cf-mono"
                value={address}
                placeholder="http://localhost:5173"
                spellCheck={false}
                aria-invalid={invalid('address-invalid')}
                aria-describedby={`${id}-address-hint`}
                aria-errormessage={errorId}
                onChange={(event) => setAddress(event.target.value)}
              />
              <span className="extdialog__hint" id={`${id}-address-hint`}>
                {t('shortcuts.form.addressHint')}
              </span>
            </div>
          ) : (
            <>
              <fieldset className="shortcut-dialog__modes">
                <legend>{t('shortcuts.form.command')}</legend>
                {(['skill', 'free'] as const).map((each) => (
                  <label key={each}>
                    <input type="radio" name={`${id}-mode`} checked={mode === each} onChange={() => setMode(each)} />
                    {t(each === 'skill' ? 'shortcuts.form.chooseSkill' : 'shortcuts.form.writeCommand')}
                  </label>
                ))}
              </fieldset>
              {mode === 'skill' ? (
                <div className="shortcut-dialog__skill">
                  <label className="shortcut-dialog__field shortcut-dialog__field--skill">
                    <span>{t('shortcuts.form.skillLabel')}</span>
                    <select
                      className="extdialog__input"
                      value={chosenSkill}
                      aria-invalid={invalid('command-missing')}
                      onChange={(event) => setSkill(event.target.value)}
                    >
                      {skills.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="shortcut-dialog__field shortcut-dialog__field--args">
                    <span>{t('shortcuts.form.args')}</span>
                    <input
                      className="extdialog__input cf-mono"
                      value={args}
                      placeholder="#14"
                      spellCheck={false}
                      aria-invalid={invalid('command-forbidden')}
                      aria-errormessage={errorId}
                      onChange={(event) => setArgs(event.target.value)}
                    />
                  </label>
                  {typeof listing === 'object' && skills.length === 0 && (
                    <p className="extdialog__hint">{t('shortcuts.form.noSkills', { project: folderName(project) })}</p>
                  )}
                </div>
              ) : (
                <label className="shortcut-dialog__field">
                  <span>{t('shortcuts.form.freeCommand')}</span>
                  <input
                    className="extdialog__input cf-mono"
                    value={text}
                    placeholder="/review --deep"
                    spellCheck={false}
                    aria-invalid={invalid('command-missing') ?? invalid('command-forbidden')}
                    aria-errormessage={errorId}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
              )}
              <div className="shortcut-dialog__preview cf-on-slate">
                <span className="shortcut-dialog__preview-label">{t('shortcuts.form.preview')}</span>
                <code className="cf-mono">{`> ${commandText(command)}`}</code>
                <span className="shortcut-dialog__preview-hint">{t('shortcuts.form.previewHint')}</span>
              </div>
              <p className="extdialog__hint">{t('shortcuts.form.commandHint')}</p>
            </>
          )}

          {shown.length > 0 && (
            <ul className="shortcut-dialog__errors" id={errorId} role="alert">
              {shown.map((problem) => (
                <li key={problem}>{t(PROBLEM_KEYS[problem])}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="cf-dialog__actions">
          <button type="button" className="cf-btn" onClick={onDone}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="cf-btn cf-btn--primary">
            {editing ? t('shortcuts.form.save') : t('shortcuts.form.add')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** Says, for a few seconds, why a Skill shortcut typed nothing: Claude is busy in the Session on show. */
export function BusyNotice({ session, onDismiss }: { session: string; onDismiss(): void }): ReactNode {
  const { t } = useTranslation()
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [session, onDismiss])
  return (
    <div className="busy-notice cf-on-slate" role="status">
      <span className="cf-dot" aria-hidden="true" />
      <span>
        <Trans i18nKey="shortcuts.busy" values={{ session }} components={{ b: <strong /> }} />
      </span>
      <button
        type="button"
        className="cf-btn cf-btn--ghost cf-btn--icon"
        aria-label={t('shortcuts.dismiss')}
        title={t('shortcuts.dismiss')}
        onClick={onDismiss}
      >
        <X className="cf-icon cf-icon--sm" aria-hidden="true" />
      </button>
    </div>
  )
}
