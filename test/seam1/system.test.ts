import { afterEach, describe, expect, it } from 'vitest'
import type { Backend } from '../../src/backend'
import { createFakeEnvironment, type FakeEnvironment } from '../fake-env'
import { startBackend } from './backend'

describe('interface language', () => {
  let env: FakeEnvironment | undefined
  let backend: Backend | undefined

  afterEach(async () => {
    backend?.dispose()
    await env?.dispose()
  })

  const languageFor = async (systemLanguages: string[]): Promise<string> => {
    env = await createFakeEnvironment({ systemLanguages })
    backend = startBackend(env)
    return (await backend.api.system.info()).language
  }

  it('is French when Windows is displayed in French', async () => {
    expect(await languageFor(['fr-FR', 'en-US'])).toBe('fr')
  })

  it('is English when Windows is displayed in English', async () => {
    expect(await languageFor(['en-GB', 'fr-FR'])).toBe('en')
  })

  it('takes the first supported language in the Windows order of preference', async () => {
    expect(await languageFor(['de-DE', 'fr-CA', 'en-US'])).toBe('fr')
  })

  it('falls back to English when no Windows language is supported', async () => {
    expect(await languageFor(['ja-JP', 'de-DE'])).toBe('en')
  })
})
