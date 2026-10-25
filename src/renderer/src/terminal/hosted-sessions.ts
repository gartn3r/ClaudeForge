import { useState, useSyncExternalStore } from 'react'
import type { HostedSessionStatus } from '../../../shared/api'
import { HostedTerminal, type SessionEnd } from './hosted-terminal'

/** One Hosted session's tab, as the title bar and the terminal area show it. */
export interface HostedTab {
  /** The tab's own key; the Session host's id only exists once `claude` has started. */
  key: string
  project: string
  terminal: HostedTerminal
  /** The name Claude Code gave its terminal; null until it gives one. */
  title: string | null
  status: HostedSessionStatus
  end: SessionEnd | null
}

export interface HostedTabs {
  /** In tab order. */
  tabs: HostedTab[]
  /** The tab on show; null when there is none. */
  activeKey: string | null
}

const tabOf = (key: string, project: string, terminal: HostedTerminal): HostedTab => ({
  key,
  project,
  terminal,
  title: terminal.title,
  status: terminal.status,
  end: terminal.end ?? null
})

/** Calls back when a tab's Hosted session changes status, with the tab as it now is. */
export type StatusListener = (tab: HostedTab) => void

/** The Hosted sessions in tab order and the one on show, kept outside React so its terminals outlive any component. */
export class HostedSessions {
  private state: HostedTabs = { tabs: [], activeKey: null }
  private readonly listeners = new Set<() => void>()
  private readonly statusListeners = new Set<StatusListener>()
  private nextKey = 1

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): HostedTabs => this.state

  /** Returns an unsubscribe. */
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Starts a Hosted session in a Project, in a new tab on show after the others. */
  start(project: string, gpuRendering: boolean): void {
    const key = String(this.nextKey++)
    const terminal = new HostedTerminal(project, gpuRendering)
    terminal.onChange(() => {
      const previous = this.state.tabs.find((tab) => tab.key === key)
      const changed = tabOf(key, project, terminal)
      this.update(this.state.tabs.map((tab) => (tab.key === key ? changed : tab)))
      if (previous && previous.status !== changed.status) {
        for (const listener of this.statusListeners) listener(changed)
      }
    })
    this.update([...this.state.tabs, tabOf(key, project, terminal)], key)
  }

  select(key: string): void {
    if (this.state.tabs.some((tab) => tab.key === key)) this.update(this.state.tabs, key)
  }

  /** Stops the tab's `claude` if it still runs and drops the tab; the next tab, else the previous one, goes on show. */
  close(key: string): void {
    const { tabs, activeKey } = this.state
    const index = tabs.findIndex((tab) => tab.key === key)
    if (index < 0) return
    tabs[index]!.terminal.dispose()
    const rest = tabs.filter((tab) => tab.key !== key)
    if (activeKey !== key) {
      this.update(rest, activeKey)
      rest.find((tab) => tab.key === activeKey)?.terminal.focus()
    } else {
      this.update(rest, (rest[index] ?? rest[index - 1])?.key ?? null)
    }
  }

  private update(tabs: HostedTab[], activeKey = this.state.activeKey): void {
    this.state = { tabs, activeKey }
    for (const listener of this.listeners) listener()
  }
}

/** The window's Hosted sessions, and the store that changes them. */
export function useHostedSessions(): HostedTabs & { sessions: HostedSessions } {
  const [sessions] = useState(() => new HostedSessions())
  const state = useSyncExternalStore(sessions.subscribe, sessions.snapshot)
  return { ...state, sessions }
}
