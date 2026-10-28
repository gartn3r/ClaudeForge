// What the right-click menus of an Element and of a Content item offer, and the request of the
// Elements contract each menu item makes: the same requests the ClaudeForge CLI makes for Claude.

import type { Shortcut } from '../../../shared/api'
import {
  itemLabel,
  type ContentItem,
  type ContentItemInput,
  type ElementRequest,
  type ElementView
} from '../../../shared/elements'
import { SHORTCUT_NAME_MAX_LENGTH } from '../../../shared/shortcuts'

export type ElementMenuKey = 'rename' | 'text-color' | 'background-color' | 'add-item' | 'hide' | 'copy-id' | 'close'

/**
 * An Element's menu items, in order, as far as it takes them: ClaudeForge's own Elements can only be
 * hidden, never closed.
 */
export function elementMenuKeys(element: ElementView): ElementMenuKey[] {
  const keys: ElementMenuKey[] = []
  if (element.takes.includes('title')) keys.push('rename')
  if (element.takes.includes('textColor')) keys.push('text-color')
  if (element.takes.includes('backgroundColor')) keys.push('background-color')
  if (element.contentKinds.length) keys.push('add-item')
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
