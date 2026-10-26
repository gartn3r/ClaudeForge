import { useEffect, useState, useSyncExternalStore } from 'react'
import type { HostedSessionStatus, ProjectSessions, SavedTab } from '../../../shared/api'
import { api } from '../api'
import { HostedTerminal, type SessionEnd, type SessionLaunch, type TypedCommand } from './hosted-terminal'

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
  /** The command ClaudeForge typed in its prompt, until the user sends it or `claude` ends; else null. */
  typed: TypedCommand | null
  /** Restored from the last time ClaudeForge ran and not selected since: its `claude` has not started. */
  dormant: boolean
}

export interface HostedTabs {
  /** In tab order. */
  tabs: HostedTab[]
  /** The tab on show; null when there is none. */
  activeKey: string | null
}

/** The last part of a Project's path: a tab's name until Claude Code names its terminal. */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** A tab's name: the one Claude Code gave its terminal, else its Project's folder name. */
export const tabTitle = (tab: HostedTab): string => tab.title ?? folderName(tab.project)

const tabOf = (
  key: string,
  project: string,
  terminal: HostedTerminal,
  typed: TypedCommand | null,
  dormant: boolean
): HostedTab => ({
  key,
  project,
  terminal,
  title: terminal.title,
  status: terminal.status,
  end: terminal.end ?? null,
  typed,
  dormant
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

  /** Starts a Hosted session in a Project, new or from one of its past Sessions, in a new tab on show after the others. */
  start(project: string, gpuRendering: boolean, launch?: SessionLaunch): void {
    const key = String(this.nextKey++)
    const terminal = new HostedTerminal(project, gpuRendering, launch)
    const typed = (launch?.kind === 'new' && launch.typed) || null
    this.update([...this.state.tabs, this.follow(key, project, terminal, typed, false)], key)
  }

  /**
   * Brings back the tabs saved when ClaudeForge last closed, after the others and dormant: none goes
   * on show, and each resumes its Session (`claude --resume`) only once selected.
   */
  restore(saved: readonly SavedTab[], gpuRendering: boolean): void {
    const restored = saved.map(({ sessionId, project, title }) => {
      const terminal = new HostedTerminal(project, gpuRendering, { kind: 'resume', sessionId }, title)
      return this.follow(String(this.nextKey++), project, terminal, null, true)
    })
    this.update([...this.state.tabs, ...restored])
  }

  /** Shows the tab; a dormant one wakes up, resuming its Session. */
  select(key: string): void {
    if (!this.state.tabs.some((tab) => tab.key === key)) return
    this.update(
      this.state.tabs.map((tab) => (tab.key === key && tab.dormant ? { ...tab, dormant: false } : tab)),
      key
    )
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

  /** Keeps the tab up to date with its terminal from now on; returns it as it starts. */
  private follow(
    key: string,
    project: string,
    terminal: HostedTerminal,
    typed: TypedCommand | null,
    dormant: boolean
  ): HostedTab {
    terminal.onChange(() => {
      // A turn starts once the user sends the command; once `claude` ends, there is none to send.
      if (terminal.status !== 'idle' || terminal.end) typed = null
      const previous = this.state.tabs.find((tab) => tab.key === key)
      if (!previous) return
      const changed = tabOf(key, project, terminal, typed, previous.dormant)
      this.update(this.state.tabs.map((tab) => (tab.key === key ? changed : tab)))
      if (previous.status !== changed.status) {
        for (const listener of this.statusListeners) listener(changed)
      }
    })
    return tabOf(key, project, terminal, typed, dormant)
  }

  private update(tabs: HostedTab[], activeKey = this.state.activeKey): void {
    this.state = { tabs, activeKey }
    for (const listener of this.listeners) listener()
  }
}

/** The window's Hosted sessions, starting with the saved tabs, dormant; and the store that changes them. */
export function useHostedSessions(
  saved: readonly SavedTab[],
  gpuRendering: boolean
): HostedTabs & { sessions: HostedSessions } {
  const [sessions] = useState(() => {
    const created = new HostedSessions()
    created.restore(saved, gpuRendering)
    return created
  })
  const state = useSyncExternalStore(sessions.subscribe, sessions.snapshot)
  return { ...state, sessions }
}

/**
 * Keeps the open tabs saved in app state as they change, so they come back dormant on the next
 * start, however ClaudeForge closes. Only a tab whose Session Claude Code keeps a history of (in the
 * Session catalog) can resume, so the others are left out: one never prompted, one that never started.
 */
export function useSavedTabs(tabs: HostedTab[], catalog: ProjectSessions[] | null, saved: readonly SavedTab[]): void {
  useEffect(() => {
    // Until the catalog is read, nothing says which Sessions can resume.
    if (!catalog) return
    const known = new Set(catalog.flatMap((group) => group.sessions.map(({ id }) => id)))
    const next = tabs.flatMap(({ terminal, project, title }): SavedTab[] => {
      const sessionId = terminal.sessionId
      return sessionId && known.has(sessionId) ? [{ sessionId, project, title }] : []
    })
    if (JSON.stringify(next) !== JSON.stringify(saved)) void api.appState.write({ tabs: next })
  }, [tabs, catalog, saved])
}
