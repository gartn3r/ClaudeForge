import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend, Updater } from '../../src/backend'
import type { UpdateStatus } from '../../src/shared/api'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

const HOUR = 60 * 60 * 1000

/** Stands in for electron-updater on GitHub releases, the boundary the backend does not own. */
function fakeUpdater(): Updater & {
  /** How many times the backend looked for a newer release. */
  checks: number
  /** Makes the next checks fail, as with no network, until called with false. */
  offline(offline: boolean): void
  /** Finishes downloading a newer release, as electron-updater reports it. */
  download(version: string): void
} {
  let failing = false
  const listeners = new Set<(version: string) => void>()
  return {
    checks: 0,
    async check() {
      this.checks++
      if (failing) throw new Error('net::ERR_INTERNET_DISCONNECTED')
    },
    onDownloaded(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    offline(offline) {
      failing = offline
    },
    download(version) {
      for (const listener of listeners) listener(version)
    }
  }
}

describe("ClaudeForge's own update", () => {
  let env: FakeEnvironment
  let backend: Backend
  let updater: ReturnType<typeof fakeUpdater>
  let pushed: UpdateStatus[]

  beforeEach(async () => {
    env = await createFakeEnvironment()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    updater = fakeUpdater()
    pushed = []
  })

  afterEach(async () => {
    backend.dispose()
    vi.useRealTimers()
    await env.dispose()
  })

  const start = (withUpdater = true): void => {
    backend = startBackend(env, undefined, undefined, undefined, withUpdater ? updater : undefined)
    backend.on('updates.changed', (status) => pushed.push(status))
  }

  it('is current in a build that does not update itself', async () => {
    start(false)

    expect(await backend.api.updates.status()).toEqual({ state: 'current' })
  })

  it('looks for a newer release as soon as ClaudeForge starts', async () => {
    start()

    await vi.waitFor(() => expect(updater.checks).toBe(1))
    expect(await backend.api.updates.status()).toEqual({ state: 'current' })
  })

  it('is ready once a newer version is downloaded, and tells the interface', async () => {
    start()

    updater.download('0.2.0')

    expect(await backend.api.updates.status()).toEqual({ state: 'ready', version: '0.2.0' })
    expect(pushed).toEqual([{ state: 'ready', version: '0.2.0' }])
  })

  it('looks again every four hours until a newer version is downloaded', async () => {
    start()
    await vi.waitFor(() => expect(updater.checks).toBe(1))

    vi.advanceTimersByTime(4 * HOUR)
    expect(updater.checks).toBe(2)
    vi.advanceTimersByTime(4 * HOUR)
    expect(updater.checks).toBe(3)

    updater.download('0.2.0')
    vi.advanceTimersByTime(12 * HOUR)
    expect(updater.checks).toBe(3)
  })

  it('stays current when GitHub cannot be reached, and tries again later', async () => {
    updater.offline(true)
    start()
    await vi.waitFor(() => expect(updater.checks).toBe(1))

    updater.offline(false)
    vi.advanceTimersByTime(4 * HOUR)

    expect(updater.checks).toBe(2)
    expect(await backend.api.updates.status()).toEqual({ state: 'current' })
    expect(pushed).toEqual([])
  })

  it('stops looking once ClaudeForge closes', async () => {
    start()
    await vi.waitFor(() => expect(updater.checks).toBe(1))

    backend.dispose()
    vi.advanceTimersByTime(8 * HOUR)

    expect(updater.checks).toBe(1)
  })
})
