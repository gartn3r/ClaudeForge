import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Backend, WindowHost } from '../../src/backend'
import type { HostedSessionStatus, WindowNotification } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

/** Stands in for the Electron window, the boundary the backend does not own. */
function fakeWindow(): WindowHost & {
  closed: boolean
  /** The notifications shown, oldest first, each with what clicking it does. */
  notifications: Array<WindowNotification & { click(): void }>
  /** Asks to close the window as Windows does, for Alt+F4 or the taskbar's "Close window". */
  requestClose(): void
} {
  let maximized = false
  const listeners = new Set<(maximized: boolean) => void>()
  const closeListeners = new Set<() => void>()
  return {
    closed: false,
    notifications: [],
    requestClose() {
      for (const listener of closeListeners) listener()
    },
    onCloseRequest(listener) {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    notify(notification, onClick) {
      this.notifications.push({ ...notification, click: onClick })
    },
    minimize() {},
    toggleMaximize() {
      maximized = !maximized
      for (const listener of listeners) listener(maximized)
    },
    close() {
      this.closed = true
    },
    isMaximized: () => maximized,
    onMaximizedChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isVisible: () => true,
    onVisibilityChange: () => () => undefined,
    onFocus: () => () => undefined
  }
}

describe('window controls', () => {
  let env: FakeEnvironment
  let backend: Backend

  afterEach(async () => {
    backend.dispose()
    await env.dispose()
  })

  it('maximize and restore the window and push each change to the interface', async () => {
    env = await createFakeEnvironment()
    backend = startBackend(env, fakeWindow())
    const pushed: boolean[] = []
    backend.on('window.maximizedChanged', ({ maximized }) => pushed.push(maximized))

    await backend.api.window.toggleMaximize()
    expect(await backend.api.window.isMaximized()).toBe(true)
    await backend.api.window.toggleMaximize()

    expect(pushed).toEqual([true, false])
  })

  it('close the window', async () => {
    env = await createFakeEnvironment()
    const win = fakeWindow()
    backend = startBackend(env, win)

    await backend.api.window.close()

    expect(win.closed).toBe(true)
  })

  it('raise a Windows notification, and tell the interface the user clicked it', async () => {
    env = await createFakeEnvironment()
    const win = fakeWindow()
    backend = startBackend(env, win)
    const clicked: string[] = []
    backend.on('window.notificationClicked', ({ tag }) => clicked.push(tag))

    await backend.api.window.notify({ tag: 'tab-2', title: 'Fix the rate limiter', body: 'Claude is waiting for you.' })

    expect(win.notifications).toEqual([
      { tag: 'tab-2', title: 'Fix the rate limiter', body: 'Claude is waiting for you.', click: expect.any(Function) }
    ])
    win.notifications[0]!.click()
    expect(clicked).toEqual(['tab-2'])
  })
})

describe('closing ClaudeForge', () => {
  let env: FakeEnvironment
  let backend: Backend
  let win: ReturnType<typeof fakeWindow>
  /** What happened, oldest first: each Hosted session's exit, and the window closing. */
  let happened: string[]
  let closeRequests: Array<{ working: string[]; unsavedEditors: string[] }>
  let statusEvents: Array<{ id: string; status: HostedSessionStatus }>
  let outputs: Map<string, string>

  afterEach(async () => {
    backend.dispose()
    await env.dispose()
  })

  const start = async (): Promise<void> => {
    env = await createFakeEnvironment()
    win = fakeWindow()
    const close = win.close.bind(win)
    happened = []
    win.close = () => {
      happened.push('closed')
      close()
    }
    backend = startBackend(env, win)
    closeRequests = []
    statusEvents = []
    outputs = new Map()
    backend.on('window.closeRequested', (request) => closeRequests.push(request))
    backend.on('sessionHost.exit', ({ id }) => happened.push(`exit ${id}`))
    backend.on('sessionHost.status', (event) => statusEvents.push(event))
    backend.on('sessionHost.output', ({ id, data }) => outputs.set(id, (outputs.get(id) ?? '') + data))
  }

  /** Starts a Session in recipe-box, waits for its prompt, and has it work for a minute if asked. */
  const startSession = async (working = false): Promise<string> => {
    const { id } = await backend.api.sessionHost.start(env.projects['recipe-box'], { cols: 100, rows: 30 })
    await vi.waitFor(() => expect(outputs.get(id)).toContain('Fake Claude Code'), { timeout: 15_000 })
    if (working) {
      await backend.api.sessionHost.write(id, '/work 60000\r')
      await vi.waitFor(() => expect(statusEvents).toContainEqual({ id, status: 'working' }), { timeout: 15_000 })
    }
    return id
  }

  it('stops every Hosted session, then closes the window once each claude has ended', async () => {
    await start()
    const first = await startSession()
    const second = await startSession()

    await backend.api.window.close()

    expect(happened).toHaveLength(3)
    expect(happened.slice(0, 2).sort()).toEqual([`exit ${first}`, `exit ${second}`].sort())
    expect(happened[2]).toBe('closed')
  })

  it('with a Hosted session working, asks the interface to warn the user, and closes only once they agree', async () => {
    await start()
    const working = await startSession(true)
    const idle = await startSession()

    await backend.api.window.close()

    expect(closeRequests).toEqual([{ working: [working], unsavedEditors: [] }])
    expect(happened).toEqual([])

    await backend.api.window.closeAnyway()

    expect(happened.slice(0, 2).sort()).toEqual([`exit ${working}`, `exit ${idle}`].sort())
    expect(happened[2]).toBe('closed')
  })

  it("goes the same way when Windows asks to close the window (Alt+F4, the taskbar's Close window)", async () => {
    await start()
    const working = await startSession(true)

    win.requestClose()

    await vi.waitFor(() => expect(closeRequests).toEqual([{ working: [working], unsavedEditors: [] }]))
    expect(happened).toEqual([])

    await backend.api.sessionHost.stop(working)
    await vi.waitFor(() => expect(happened).toEqual([`exit ${working}`]), { timeout: 15_000 })
    win.requestClose()

    await vi.waitFor(() => expect(happened).toEqual([`exit ${working}`, 'closed']))
  })

  it('with an editor tab unsaved, asks the interface to warn the user, and closes only once they agree', async () => {
    await start()
    const idle = await startSession()
    await backend.api.window.setUnsavedEditors(['editor-1', 'editor-3'])

    await backend.api.window.close()

    expect(closeRequests).toEqual([{ working: [], unsavedEditors: ['editor-1', 'editor-3'] }])
    expect(happened).toEqual([])

    // Alt+F4 warns the same way, naming the Hosted session that started working meanwhile too.
    await backend.api.sessionHost.write(idle, '/work 60000\r')
    await vi.waitFor(() => expect(statusEvents).toContainEqual({ id: idle, status: 'working' }), { timeout: 15_000 })
    win.requestClose()

    await vi.waitFor(() =>
      expect(closeRequests.at(-1)).toEqual({ working: [idle], unsavedEditors: ['editor-1', 'editor-3'] })
    )
    expect(happened).toEqual([])

    await backend.api.window.closeAnyway()

    expect(happened).toEqual([`exit ${idle}`, 'closed'])
  })

  it('closes at once once every editor tab is saved again', async () => {
    await start()
    await backend.api.window.setUnsavedEditors(['editor-1'])
    await backend.api.window.setUnsavedEditors([])

    win.requestClose()

    await vi.waitFor(() => expect(happened).toEqual(['closed']))
    expect(closeRequests).toEqual([])
  })
})
