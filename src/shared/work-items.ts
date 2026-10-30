// The rules of the Work items card (CONTEXT.md, Backlog; ADR 0008), shared by the backend, which
// reads the backlog through `az`, the app state, which keeps the configuration and the Work item
// actions, and the interface, which shows them.

import type { BacklogConfig, Sprint, WorkItem, WorkItemAction } from './api'
import { hasForbiddenCharacter } from './shortcuts'

/** The most Work item actions there can be. */
export const MAX_WORK_ITEM_ACTIONS = 3

/** The longest label a Work item action can have. */
export const ACTION_LABEL_MAX_LENGTH = 40

/** What a Work item action's text can name of the Work item. */
export const PLACEHOLDERS = ['{id}', '{title}', '{type}', '{url}'] as const

/** The colours offered to the second and third actions, beside outline and any other colour; never lime. */
export const ACTION_COLOURS = {
  slate: '#2f353f',
  blue: '#8fb3d9',
  cyan: '#8ccbc4',
  yellow: '#e3c76a',
  coral: '#e58a7a',
  mauve: '#c9a3d9'
} as const

/** The first action's colour, the design's accent. */
export const LIME = '#b0c92e'

/** The design's dark and light text, which an action's label is written in. */
const DARK_TEXT = '#2f353f'
const LIGHT_TEXT = '#f5f1e3'

/** What the form refuses in a Work item action, each with its own message. */
export type ActionProblem = 'label-missing' | 'skill-missing' | 'text-forbidden'

// The Current sprint

/** Today, or any moment, as the user's calendar day: `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The Current sprint: the one whose days contain today; between two sprints, the next one to start,
 * upcoming. Null when none runs or is to come.
 */
export function currentSprint(sprints: readonly Sprint[], today: string): { sprint: Sprint; upcoming: boolean } | null {
  const byStart = [...sprints].sort((a, b) => a.start.localeCompare(b.start))
  const running = byStart.filter((sprint) => sprint.start <= today && today <= sprint.finish).at(-1)
  if (running) return { sprint: running, upcoming: false }
  const next = byStart.find((sprint) => sprint.start > today)
  return next ? { sprint: next, upcoming: true } : null
}

// Classification nodes, as `az boards iteration|area project list` gives them

/** A classification node: `az` gives each its path in its own tree, `\Acme\Iteration\Retail\Team`. */
interface ClassificationNode {
  name?: unknown
  path?: unknown
  attributes?: { startDate?: unknown; finishDate?: unknown } | null
  children?: unknown
}

/** The node `az` lists an iteration or area under: `Acme\Retail` is `\Acme\Iteration\Retail`. */
export function classificationPath(path: string, tree: 'Iteration' | 'Area'): string {
  const [project, ...rest] = path.split('\\').filter(Boolean)
  return ['', project, tree, ...rest].join('\\')
}

/** The path a Work item names a node with: `\Acme\Iteration\Retail` is `Acme\Retail`. */
export function itemPath(path: string): string {
  const [project, , ...rest] = path.split('\\').filter(Boolean)
  return [project, ...rest].join('\\')
}

/** Every well-formed node of a tree, the root first, each before its children. */
function nodesOf(root: unknown): ClassificationNode[] {
  if (typeof root !== 'object' || root === null) return []
  const node = root as ClassificationNode
  if (typeof node.path !== 'string') return []
  const children = Array.isArray(node.children) ? node.children : []
  return [node, ...children.flatMap(nodesOf)]
}

/** The calendar day of a date `az` gives, `2026-11-13T00:00:00Z`; null for anything else. */
const dayOf = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null

/** The sprints of an iteration tree, at any depth: the iterations with both their dates. */
export function sprintsIn(tree: unknown): Sprint[] {
  return nodesOf(tree).flatMap((node) => {
    const start = dayOf(node.attributes?.startDate)
    const finish = dayOf(node.attributes?.finishDate)
    if (!start || !finish || typeof node.name !== 'string') return []
    return [{ name: node.name, path: itemPath(node.path as string), start, finish }]
  })
}

/** The paths of a tree's nodes: every one (areas), or only those holding a sprint beneath them (iteration roots). */
export function pathsIn(tree: unknown, which: 'all' | 'folders'): string[] {
  return nodesOf(tree)
    .filter((node) => which === 'all' || nodesOf(node).slice(1).some((below) => dayOf(below.attributes?.startDate)))
    .map((node) => itemPath(node.path as string))
}

// The query and its answer

/** A text as WIQL quotes it: single quotes doubled. */
const quoted = (text: string): string => `'${text.replaceAll("'", "''")}'`

/**
 * The WIQL that lists the Work items of the area in a sprint that are unassigned or assigned to the
 * user and neither done nor removed, in backlog order. `az` answers only with the fields it selects.
 */
export function workItemsQuery(config: BacklogConfig, sprintPath: string): string {
  return (
    'SELECT [System.Id],[System.WorkItemType],[System.State],[System.AssignedTo],[System.Title] FROM WorkItems' +
    ` WHERE [System.AreaPath] UNDER ${quoted(config.areaPath)}` +
    ` AND [System.IterationPath] = ${quoted(sprintPath)}` +
    " AND ([System.AssignedTo] = @Me OR [System.AssignedTo] = '')" +
    " AND [System.State] NOT IN ('Done','Removed','Closed')" +
    ' ORDER BY [Microsoft.VSTS.Common.StackRank]'
  )
}

/**
 * The Work items of `az boards query`'s answer, in its order, those without an id, type, state or
 * title left out. The query asks only for the user's and the unassigned ones, so any with an
 * assignee is the user's.
 */
export function parseWorkItems(json: unknown): WorkItem[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((entry) => {
    const { id, fields } = (entry ?? {}) as { id?: unknown; fields?: Record<string, unknown> }
    if (!Number.isInteger(id) || typeof fields !== 'object' || fields === null) return []
    const type = fields['System.WorkItemType']
    const state = fields['System.State']
    const title = fields['System.Title']
    if (typeof type !== 'string' || typeof state !== 'string' || typeof title !== 'string') return []
    return [{ id: id as number, type, state, title, assignedToMe: !!fields['System.AssignedTo'] }]
  })
}

// How a Work item shows

/** The glyph a Work item type shows with, and the word written beside it, when one is. */
export interface WorkItemKind {
  glyph: 'pbi' | 'bug' | 'task' | 'feature' | 'other'
  label: string | null
}

/** Every type whose name starts with "Bug" (`BugInnovation`) is a Bug; a type without a glyph of its own is written out. */
export function workItemKind(type: string): WorkItemKind {
  if (/^bug/i.test(type)) return { glyph: 'bug', label: 'Bug' }
  const glyph = ({ 'Product Backlog Item': 'pbi', Task: 'task', Feature: 'feature' } as const)[type]
  return glyph ? { glyph, label: null } : { glyph: 'other', label: type }
}

/** The states of a Work item no one has started yet. */
const NOT_STARTED = new Set(['to do', 'to refine', 'new', 'proposed', 'approved'])

/** Whether a Work item's state is one of work in progress (a solid dot) rather than not started (a ring). */
export const workItemStarted = (state: string): boolean => !NOT_STARTED.has(state.trim().toLowerCase())

/** An organisation as its address, given that or its name alone; empty stays empty. */
export function organizationUrl(input: string): string {
  const text = input.trim().replace(/\/+$/, '')
  if (!text || /^https?:\/\//i.test(text)) return text
  return `https://devops.example.test/${text}`
}

/** Where a Work item opens in Azure DevOps. */
export const workItemUrl = (config: BacklogConfig, id: number): string =>
  `${organizationUrl(config.organization)}/${encodeURIComponent(config.project)}/_workitems/edit/${id}`

/** Whether a configuration has every field it needs to read the backlog. */
export const backlogConfigured = (config: BacklogConfig | null): config is BacklogConfig =>
  !!config && /^https?:\/\/\S+$/i.test(config.organization) && !!config.project && !!config.areaPath && !!config.iterationRoot

/** The configuration as the app state keeps it: trimmed, the organisation as an address. */
export const tidyBacklogConfig = (config: BacklogConfig): BacklogConfig => ({
  organization: organizationUrl(config.organization),
  project: config.project.trim(),
  areaPath: config.areaPath.trim(),
  iterationRoot: config.iterationRoot.trim()
})

// Work item actions

/**
 * The command an action types for a Work item: its skill, then its text with each placeholder filled
 * once. What `--prefill` cannot type is changed: a double quote becomes a single one, a percent sign
 * goes, a line break becomes a space.
 */
export function actionCommand(action: WorkItemAction, workItem: WorkItem, url: string): string {
  const values: Record<string, string> = { id: String(workItem.id), title: workItem.title, type: workItem.type, url }
  const text = action.text.replace(/\{(id|title|type|url)\}/g, (_, name: string) => values[name]!)
  const typeable = text.replaceAll('"', "'").replaceAll('%', '').replace(/\r\n|[\r\n]/g, ' ').trim()
  return `/${action.skill.trim()}${typeable ? ` ${typeable}` : ''}`
}

/** What is wrong with an action, in the order the form shows it; empty when it can be kept. */
export function actionProblems(action: WorkItemAction): ActionProblem[] {
  const problems: ActionProblem[] = []
  if (!action.label.trim()) problems.push('label-missing')
  if (!/^[^\s/"%]+$/.test(action.skill.trim())) problems.push('skill-missing')
  if (hasForbiddenCharacter(action.text)) problems.push('text-forbidden')
  return problems
}

/** An action the user has not filled at all, which is left out rather than refused. */
export const isBlankAction = (action: WorkItemAction): boolean => !action.label.trim() && !action.skill.trim() && !action.text.trim()

const HEX = /^#[0-9a-f]{6}$/i

/** A colour an action can keep: outline, or any `#rrggbb` but lime. */
const tidyColour = (colour: string): string => {
  const hex = colour.trim().toLowerCase()
  return HEX.test(hex) && hex !== LIME ? hex : 'outline'
}

/** The actions as the app state keeps them: trimmed, three at most, refused, blank or repeated ones left out. */
export function tidyWorkItemActions(actions: readonly WorkItemAction[]): WorkItemAction[] {
  const ids = new Set<string>()
  return actions
    .filter((action) => {
      if (!action.id || ids.has(action.id) || isBlankAction(action) || actionProblems(action).length) return false
      ids.add(action.id)
      return true
    })
    .slice(0, MAX_WORK_ITEM_ACTIONS)
    .map((action) => ({
      id: action.id,
      label: action.label.trim().slice(0, ACTION_LABEL_MAX_LENGTH),
      skill: action.skill.trim(),
      text: action.text.trim(),
      colour: tidyColour(action.colour)
    }))
}

/** The colour an action shows in: the first always lime, the others their own, outline when it is lime. */
export const actionColour = (action: WorkItemAction, index: number): string => (index === 0 ? LIME : tidyColour(action.colour))

/** A `#rrggbb` colour's relative luminance, as WCAG defines it. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** The WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/**
 * The text an action's label is written in on its colour: the design's dark or light text, whichever
 * contrasts more; black or white when neither reads at 4.5:1.
 */
export function textOn(background: string): string {
  const best = (a: string, b: string): string => (contrastRatio(a, background) >= contrastRatio(b, background) ? a : b)
  const text = best(DARK_TEXT, LIGHT_TEXT)
  return contrastRatio(text, background) >= 4.5 ? text : best('#000000', '#ffffff')
}
