import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'

/** One Web tab, showing its Web shortcut's page beside the Hosted sessions (ADR 0006). */
export interface WebTab {
  /** Unlike any Hosted session's or editor's key, so tab and panel ids built from either never collide. */
  key: string
  /** The Web shortcut it shows, which names it. */
  shortcutId: string
  /** Restored from the last time ClaudeForge ran and not selected since: its page has not loaded. */
  dormant: boolean
}

export interface WebTabsState {
  /** In tab order. */
  tabs: WebTab[]
  /** The Web tab on show; null when a Hosted session's terminal or an editor is. */
  activeKey: string | null
}

const keyOf = (shortcutId: string): string => `web-${shortcutId}`

/** The Web tabs and the one on show, kept outside React like the Hosted sessions and the editors. */
export class WebTabs {
  private state: WebTabsState = { tabs: [], activeKey: null }
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): WebTabsState => this.state

  /** Brings back the Web tabs open when ClaudeForge last closed, dormant: none goes on show, none loads yet. */
  restore(shortcutIds: readonly string[]): void {
    this.update(shortcutIds.map((shortcutId) => ({ key: keyOf(shortcutId), shortcutId, dormant: true })))
  }

  /** Shows the Web shortcut's page: in its Web tab if one is open, else in a new one after the others. */
  open(shortcutId: string): void {
    const key = keyOf(shortcutId)
    if (this.state.tabs.some((tab) => tab.key === key)) return this.select(key)
    this.update([...this.state.tabs, { key, shortcutId, dormant: false }], key)
  }

  /** Shows the tab; a dormant one loads its page. */
  select(key: string): void {
    if (!this.state.tabs.some((tab) => tab.key === key)) return
    this.update(
      this.state.tabs.map((tab) => (tab.key === key && tab.dormant ? { ...tab, dormant: false } : tab)),
      key
    )
  }

  /** A Hosted session or an editor goes on show instead. */
  deselect(): void {
    if (this.state.activeKey !== null) this.update(this.state.tabs, null)
  }

  /** Drops the tab; closing the one on show shows the next Web tab, else the previous one, else what was on show before. */
  close(key: string): void {
    const { tabs, activeKey } = this.state
    const index = tabs.findIndex((tab) => tab.key === key)
    if (index < 0) return
    const rest = tabs.filter((tab) => tab.key !== key)
    this.update(rest, activeKey !== key ? activeKey : ((rest[index] ?? rest[index - 1])?.key ?? null))
  }

  /** Closes the tabs whose Web shortcut is gone, or is no longer a Web shortcut. */
  keepOnly(shortcutIds: ReadonlySet<string>): void {
    for (const tab of this.state.tabs) if (!shortcutIds.has(tab.shortcutId)) this.close(tab.key)
  }

  private update(tabs: WebTab[], activeKey = this.state.activeKey): void {
    this.state = { tabs, activeKey }
    for (const listener of this.listeners) listener()
  }
}

/**
 * The window's Web tabs, starting with those saved, dormant; and the store that changes them. The
 * open ones are kept in app state as they change, so they come back on the next start.
 */
export function useWebTabs(saved: readonly string[]): WebTabsState & { web: WebTabs } {
  const [web] = useState(() => {
    const created = new WebTabs()
    created.restore(saved)
    return created
  })
  const state = useSyncExternalStore(web.subscribe, web.snapshot)
  // Compared as text, so a state pushed back with the same tabs writes nothing.
  const open = JSON.stringify(state.tabs.map((tab) => tab.shortcutId))
  const kept = JSON.stringify(saved)
  useEffect(() => {
    if (open !== kept) void api.appState.write({ webTabs: JSON.parse(open) as string[] })
  }, [open, kept])
  return { ...state, web }
}
