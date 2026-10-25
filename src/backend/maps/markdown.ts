// Reading the markdown Wayfinder writes, whichever Tracker holds it: a Map's
// sections and a Ticket's question and answer.

/** Splits a markdown text into its `## Heading` sections, keyed by lower-case heading. */
export function sectionsOf(text: string): Record<string, string> {
  const sections: Record<string, string> = {}
  let current: string | null = null
  const lines: string[] = []
  const flush = (): void => {
    if (current !== null) sections[current] = lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
    lines.length = 0
  }
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      flush()
      current = heading[1]!.toLowerCase()
    } else if (current !== null) lines.push(line)
  }
  flush()
  return sections
}

/**
 * A Ticket's question: its `## Question` section, else the text before its
 * first section, without its title and the metadata lines the Tracker uses.
 */
export function questionOf(text: string, sections: Record<string, string>, metadataLine: RegExp): string {
  if (sections.question !== undefined) return sections.question
  const body = text.split(/^##\s/m)[0]!
  return body
    .split(/\r?\n/)
    .filter((line) => !/^\s*#\s/.test(line) && !metadataLine.test(line))
    .join('\n')
    .trim()
}
