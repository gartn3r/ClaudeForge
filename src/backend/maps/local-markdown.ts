// The local markdown Tracker, as Wayfinder writes it: one effort per folder
// under `.scratch/`, with a `map.md` and one numbered file per Ticket in
// `issues/` (`NN-<slug>.md`) carrying `Type:`, `Status:` and `Blocked by:` lines.

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { MapSummary, TicketType } from '../../shared/api'
import { questionOf, sectionsOf } from './markdown'
import type { MapRecord, TicketRecord } from './model'

const SCRATCH = '.scratch'

const TICKET_FILE = /^(\d+)-(.+)\.md$/i
const METADATA_LINE = /^(Type|Status|Blocked by|Parent)\s*:/i
const TICKET_TYPES: readonly TicketType[] =['research', 'prototype', 'grilling', 'task']

/** `week-view` → `Week view`: the name of a file whose title is missing. */
const nameFromSlug = (slug: string): string => {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The text of a `# Title` line, if the file starts with one. */
const titleOf = (text: string): string | null => /^\s*#\s+(.+?)\s*$/m.exec(text)?.[1] ?? null

/** The value of a `Key: value` metadata line. */
const fieldOf = (text: string, key: string): string | null =>
  new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`, 'im').exec(text)?.[1] ?? null

async function readTicket(path: string, number: string, slug: string): Promise<TicketRecord> {
  const text = await readFile(path, 'utf8')
  const sections = sectionsOf(text)
  const status = fieldOf(text, 'Status')?.toLowerCase() ?? 'open'
  const type = fieldOf(text, 'Type')?.toLowerCase()
  return {
    id: number,
    name: titleOf(text) ?? nameFromSlug(slug),
    type: TICKET_TYPES.find((known) => known === type) ?? null,
    open: status !== 'resolved' && status !== 'closed',
    claimed: status === 'claimed',
    // Local markdown claims name no one: the files, and the claim, are the user's own.
    claimedByUser: status === 'claimed',
    assignee: null,
    blockedBy: (fieldOf(text, 'Blocked by') ?? '').match(/\d+/g) ?? [],
    path,
    question: questionOf(text, sections, METADATA_LINE),
    answer: sections.answer ?? ''
  }
}

/** The effort folders of a Project that hold a `map.md`. */
async function effortsOf(project: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(project, SCRATCH), { withFileTypes: true })
  } catch {
    return []
  }
  const efforts: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      if ((await stat(join(project, SCRATCH, entry.name, 'map.md'))).isFile()) efforts.push(entry.name)
    } catch {
      // A folder without a map.md holds something else, a spec for instance.
    }
  }
  return efforts
}

/** Reads one effort's Map; the effort must be a folder directly under `.scratch/` holding a `map.md`. */
export async function readMap(project: string, effort: string): Promise<MapRecord> {
  if (!(await effortsOf(project)).includes(effort)) throw new Error(`No Map named ${effort} in ${project}`)
  return readEffort(project, effort)
}

async function readEffort(project: string, effort: string): Promise<MapRecord> {
  const folder = join(project, SCRATCH, effort)
  const path = join(folder, 'map.md')
  const text = await readFile(path, 'utf8')
  let updatedAt = (await stat(path)).mtimeMs

  let files: string[] = []
  try {
    files = await readdir(join(folder, 'issues'))
  } catch {
    // A Map charted without Tickets yet.
  }
  const tickets: TicketRecord[] = []
  // In Ticket number order, whatever the width of the numbers.
  const numbered = files.flatMap((file) => {
    const match = TICKET_FILE.exec(file)
    return match ? [{ file, number: match[1]!, slug: match[2]! }] : []
  })
  numbered.sort((a, b) => Number(a.number) - Number(b.number))
  for (const { file, number, slug } of numbered) {
    const ticketPath = join(folder, 'issues', file)
    tickets.push(await readTicket(ticketPath, number, slug))
    updatedAt = Math.max(updatedAt, (await stat(ticketPath)).mtimeMs)
  }

  // `Blocked by: 2` names the Ticket filed as `02`.
  const byNumber = new Map(tickets.map((ticket) => [Number(ticket.id), ticket.id]))
  for (const ticket of tickets) {
    ticket.blockedBy = [...new Set(ticket.blockedBy.map((ref) => byNumber.get(Number(ref)) ?? ref))]
  }

  return {
    id: effort,
    name: titleOf(text) ?? nameFromSlug(basename(folder)),
    path,
    updatedAt,
    open: tickets.length === 0 || tickets.some((ticket) => ticket.open),
    sections: sectionsOf(text),
    tickets
  }
}

export async function listMaps(project: string): Promise<MapSummary[]> {
  const maps = await Promise.all((await effortsOf(project)).map((effort) => readEffort(project, effort)))
  return maps
    .map(({ id, name, path, updatedAt, open }) => ({ id, name, path, updatedAt, open }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
