import { useState, useSyncExternalStore } from 'react'
import type { ExtensionFile } from '../../../shared/api'

/** A skill's or subagent's file to open in an editor tab. */
export type EditorTarget = Omit<ExtensionFile, 'text'> & {
  /** The Project the Extensions menu showed it for: the backend opens only its files and the user's. */
  project: string
  /** The skill's or subagent's name, which the tab shows. */
  name: string
}

/** One editor tab, after the Hosted sessions' tabs in the title bar. */
export interface EditorTab extends EditorTarget {
  /** Unlike any Hosted session tab's key, so tab and panel ids built from either never collide. */
  key: string
  /** The text differs from the file as last read or saved. */
  dirty: boolean
}

export interface EditorTabsState {
  /** In tab order. */
  tabs: EditorTab[]
  /** The editor on show; null when a Hosted session's terminal is. */
  activeKey: string | null
}

/** Windows paths ignore case and slash direction. */
const fileKey = (path: string): string => path.replace(/\//g, '\\').toLowerCase()

/** The editor tabs and the one on show, kept outside React like the Hosted sessions. */
export class EditorTabs {
  private state: EditorTabsState = { tabs: [], activeKey: null }
  private readonly listeners = new Set<() => void>()
  private nextKey = 1

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): EditorTabsState => this.state

  /** Shows the file's editor, opening a tab after the others unless one already holds it. */
  open(target: EditorTarget): void {
    const open = this.state.tabs.find((tab) => fileKey(tab.file) === fileKey(target.file))
    if (open) return this.update(this.state.tabs, open.key)
    const key = `editor-${this.nextKey++}`
    this.update([...this.state.tabs, { ...target, key, dirty: false }], key)
  }

  select(key: string): void {
    if (this.state.tabs.some((tab) => tab.key === key)) this.update(this.state.tabs, key)
  }

  /** A Hosted session goes on show instead. */
  deselect(): void {
    if (this.state.activeKey !== null) this.update(this.state.tabs, null)
  }

  /** The file was saved under another name in its frontmatter. */
  rename(key: string, name: string): void {
    this.update(this.state.tabs.map((tab) => (tab.key === key ? { ...tab, name } : tab)))
  }

  setDirty(key: string, dirty: boolean): void {
    if (this.state.tabs.find((tab) => tab.key === key)?.dirty === dirty) return
    this.update(this.state.tabs.map((tab) => (tab.key === key ? { ...tab, dirty } : tab)))
  }

  /**
   * Drops the tab, unsaved changes and all. Closing the one on show shows the next editor, else the
   * previous one, else the Hosted session that was on show before.
   */
  close(key: string): void {
    const { tabs, activeKey } = this.state
    const index = tabs.findIndex((tab) => tab.key === key)
    if (index < 0) return
    const rest = tabs.filter((tab) => tab.key !== key)
    this.update(rest, activeKey !== key ? activeKey : ((rest[index] ?? rest[index - 1])?.key ?? null))
  }

  private update(tabs: EditorTab[], activeKey = this.state.activeKey): void {
    this.state = { tabs, activeKey }
    for (const listener of this.listeners) listener()
  }
}

/** The window's editor tabs, and the store that changes them. */
export function useEditorTabs(): EditorTabsState & { editors: EditorTabs } {
  const [editors] = useState(() => new EditorTabs())
  const state = useSyncExternalStore(editors.subscribe, editors.snapshot)
  return { ...state, editors }
}
