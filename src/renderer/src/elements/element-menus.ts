// What the right-click menus of an Element and of a Content item offer, and the request of the
// Elements contract each menu item makes: the same requests the ClaudeForge CLI makes for Claude.

import type { Shortcut } from '../../../shared/api'
import {
  ELEMENT_NAME_MAX_LENGTH,
  itemLabel,
  type ContentItem,
  type ContentItemInput,
  type CreatedElementKind,
  type ElementRequest,
  type ElementView
} from '../../../shared/elements'
import { SHORTCUT_NAME_MAX_LENGTH } from '../../../shared/shortcuts'

export type ElementMenuKey =
  | 'rename'
  | 'text-color'
  | 'background-color'
  | 'add-item'
  | 'collapse'
  | 'expand'
  | 'move-up'
  | 'move-down'
  | 'hide'
  | 'copy-id'
  | 'close'

/** The visible Elements of a container, in its order, the Element itself included. */
const shownAmong = (siblings: readonly ElementView[], element: ElementView): ElementView[] =>
  siblings.filter((each) => each.id === element.id || each.properties.visible !== false)

/**
 * An Element's menu items, in order, as far as it takes them: ClaudeForge's own Elements can only be
 * hidden, never closed. Given the Elements of its container in their order, it moves among them.
 */
export function elementMenuKeys(element: ElementView, siblings?: readonly ElementView[]): ElementMenuKey[] {
  const keys: ElementMenuKey[] = []
  if (element.takes.includes('title')) keys.push('rename')
  if (element.takes.includes('textColor')) keys.push('text-color')
  if (element.takes.includes('backgroundColor')) keys.push('background-color')
  if (element.contentKinds.length) keys.push('add-item')
  if (element.takes.includes('collapsed')) keys.push(element.properties.collapsed ? 'expand' : 'collapse')
  if (siblings && element.takes.includes('order')) {
    const shown = shownAmong(siblings, element)
    const at = shown.findIndex((each) => each.id === element.id)
    if (at > 0) keys.push('move-up')
    if (at >= 0 && at < shown.length - 1) keys.push('move-down')
  }
  if (element.takes.includes('visible')) keys.push('hide')
  keys.push('copy-id')
  if (element.kind) keys.push('close')
  return keys
}

export type ItemMenuKey = 'keep-as-shortcut' | 'edit' | 'copy-id' | 'remove'

/** A Content item's menu items, in order: only a link or an action can be kept as a Shortcut. */
export const itemMenuKeys = (item: ContentItem): ItemMenuKey[] =>
  item.kind === 'link' || item.kind === 'action' ? ['keep-as-shortcut', 'edit', 'copy-id', 'remove'] : ['edit', 'copy-id', 'remove']

/** Where a request reaches the Element: a Created Element in its Project, ClaudeForge's own anywhere. */
export const reach = (element: ElementView): { project?: string; element: string } =>
  element.project === null ? { element: element.id } : { project: element.project, element: element.id }

export const hideRequest = (element: ElementView): ElementRequest => ({ op: 'set', ...reach(element), properties: { visible: false } })

export const collapseRequest = (element: ElementView, collapsed: boolean): ElementRequest => ({
  op: 'set',
  ...reach(element),
  properties: { collapsed }
})

/**
 * Moves an Element just past its visible neighbour, up (-1) or down (1), hidden ones passed over: its
 * container is numbered again from 1, and only the orders that change are asked for.
 */
export function moveRequests(siblings: readonly ElementView[], element: ElementView, step: -1 | 1): ElementRequest[] {
  const shown = shownAmong(siblings, element)
  const neighbour = shown[shown.findIndex((each) => each.id === element.id) + step]
  if (!neighbour) return []
  const next = siblings.filter((each) => each.id !== element.id)
  next.splice(next.indexOf(neighbour) + (step > 0 ? 1 : 0), 0, element)
  return next.flatMap((each, index) =>
    each.properties.order === index + 1 ? [] : [{ op: 'set', ...reach(each), properties: { order: index + 1 } } as const]
  )
}

/** The identifier a title suggests: its letters and numbers, unaccented, in lowercase words joined by hyphens. */
export const nameFromTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, ELEMENT_NAME_MAX_LENGTH)
    .replace(/-+$/, '')

/** Creates a card or a menu in the displayed Project; without a title, its name is its title. */
export const createRequest = (kind: CreatedElementKind, project: string, name: string, title: string): ElementRequest => ({
  op: 'create',
  project,
  kind,
  name: name.trim(),
  ...(title.trim() ? { title: title.trim() } : {})
})

export const closeRequest = (element: ElementView): ElementRequest => ({ op: 'close', ...reach(element) })

/** An empty title gives back the default one. */
export const renameRequest = (element: ElementView, title: string): ElementRequest => ({
  op: 'set',
  ...reach(element),
  properties: { title: title.trim() || null }
})

/** A null colour gives back the design's. */
export const colorRequest = (
  element: ElementView,
  property: 'textColor' | 'backgroundColor',
  color: string | null
): ElementRequest => ({ op: 'set', ...reach(element), properties: { [property]: color } })

/** Adds the Content item, or, under the id of one already there (an edit), replaces it. */
export const itemRequest = (element: ElementView, item: ContentItemInput): ElementRequest => ({ op: 'add', ...reach(element), item })

export const removeRequest = (element: ElementView, item: ContentItem): ElementRequest => ({
  op: 'remove',
  ...reach(element),
  item: item.id
})

/**
 * The Shortcut a link or an action is kept as, a copy that lives apart from it from then on: a link
 * as a Web shortcut, an action as a Skill shortcut typing its command. Null for any other item.
 */
export function shortcutOf(item: ContentItem, id: string): Shortcut | null {
  const name = itemLabel(item).slice(0, SHORTCUT_NAME_MAX_LENGTH)
  if (item.kind === 'link') return { id, name, kind: 'web', address: item.address }
  if (item.kind === 'action') return { id, name, kind: 'skill', command: { mode: 'free', text: item.command } }
  return null
}
