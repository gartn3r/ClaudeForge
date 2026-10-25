// Fails when the translation files do not carry exactly the same keys, or a value is empty.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '../src/renderer/src/locales')
const REFERENCE = 'en.json'

const keys = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' ? keys(child, `${prefix}${key}.`) : [[`${prefix}${key}`, child]]
  )

const load = (file) => new Map(keys(JSON.parse(readFileSync(join(DIR, file), 'utf8'))))
const reference = load(REFERENCE)
const problems = []

for (const file of readdirSync(DIR).filter((name) => name.endsWith('.json'))) {
  const strings = load(file)
  for (const key of reference.keys()) if (!strings.has(key)) problems.push(`${file}: missing ${key}`)
  for (const [key, text] of strings) {
    if (!reference.has(key)) problems.push(`${file}: ${key} is not in ${REFERENCE}`)
    if (typeof text !== 'string' || text.trim() === '') problems.push(`${file}: ${key} is empty`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`Translation files agree (${reference.size} strings).`)
