import { SUPPORTED_LANGUAGES, type Language } from '../shared/api'

/**
 * Picks the interface language from the Windows display languages, in the
 * user's order of preference (BCP 47 tags such as `fr-FR` or `en-US`).
 * The first supported one wins; English is the fallback.
 */
export function resolveLanguage(systemLanguages: readonly string[]): Language {
  for (const tag of systemLanguages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0]
    const match = SUPPORTED_LANGUAGES.find((language) => language === primary)
    if (match) return match
  }
  return 'en'
}
