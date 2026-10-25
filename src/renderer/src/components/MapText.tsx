import type { ReactNode } from 'react'

// The little markdown a Map's sections hold: paragraphs and list items with
// links, bold and code. Links show as their text; the interface never navigates.

const INLINE = /\[([^\]]+)\]\([^)]*\)|\*\*([^*]+)\*\*|`([^`]+)`/g

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const [, link, bold, code] = match
    if (link !== undefined) parts.push(link)
    else if (bold !== undefined) parts.push(<strong key={match.index}>{bold}</strong>)
    else parts.push(<code key={match.index}>{code}</code>)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

type Block = { kind: 'item' | 'paragraph'; text: string }

function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const item = /^\s*[-*+]\s+(.*)$/.exec(line)
    const last = blocks.at(-1)
    if (item) blocks.push({ kind: 'item', text: item[1]! })
    else if (line.trim() === '') blocks.push({ kind: 'paragraph', text: '' })
    else if (last && last.text !== '') last.text += ` ${line.trim()}`
    else blocks.push({ kind: 'paragraph', text: line.trim() })
  }
  return blocks.filter((block) => block.text !== '')
}

/** How many list items a section holds, for its count. */
export const itemCount = (markdown: string): number =>
  blocksOf(markdown).filter((block) => block.kind === 'item').length

export function MapText({ markdown }: { markdown: string }): ReactNode {
  const blocks = blocksOf(markdown)
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (block.kind === 'paragraph') {
      out.push(<p key={i}>{inline(block.text)}</p>)
      continue
    }
    const items: ReactNode[] = []
    for (; i < blocks.length && blocks[i]!.kind === 'item'; i++) items.push(<li key={i}>{inline(blocks[i]!.text)}</li>)
    i--
    out.push(<ul key={i}>{items}</ul>)
  }
  return <div className="map-text">{out}</div>
}
