/** An App title as the wordmark sets it: the lime marker stroke goes behind `marked` alone. */
export interface WordmarkParts {
  lead: string
  marked: string
}

/**
 * Where the wordmark's marker stroke falls: behind the last word, or behind the last part of a
 * word written in camel case, as behind "Forge" in ClaudeForge.
 */
export function wordmarkParts(title: string): WordmarkParts {
  const start = title.search(/\S+$/)
  const word = start < 0 ? 0 : start
  const camel = /\p{Ll}(\p{Lu}[^\p{Lu}]*)$/u.exec(title.slice(word))
  const cut = camel ? title.length - camel[1]!.length : word
  return { lead: title.slice(0, cut), marked: title.slice(cut) }
}
