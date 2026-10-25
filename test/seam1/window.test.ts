import { afterEach, describe, expect, it } from 'vitest'
import type { Backend, WindowHost } from '../../src/backend'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

/** Stands in for the Electron window, the boundary the backend does not own. */
function fakeWindow(): WindowHost & { closed: boolean } {
  let maximized = false
  const listeners = new Set<(maximized: boolean) => void>()
  return {
    closed: false,
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
})
