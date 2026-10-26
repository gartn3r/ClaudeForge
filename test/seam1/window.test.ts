import { afterEach, describe, expect, it } from 'vitest'
import type { Backend, WindowHost } from '../../src/backend'
import type { WindowNotification } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

/** Stands in for the Electron window, the boundary the backend does not own. */
function fakeWindow(): WindowHost & {
  closed: boolean
  /** The notifications shown, oldest first, each with what clicking it does. */
  notifications: Array<WindowNotification & { click(): void }>
} {
  let maximized = false
  const listeners = new Set<(maximized: boolean) => void>()
  return {
    closed: false,
    notifications: [],
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
    }
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
