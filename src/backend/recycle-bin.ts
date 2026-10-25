import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Moves a file or folder to the Windows Recycle Bin, as Electron's `shell.trashItem` does. */
export type TrashItem = (path: string) => Promise<void>

const ORIGIN = 'origin.txt'

/**
 * A folder standing in for the Recycle Bin, for tests: each item lands in a slot of its own,
 * numbered in the order it arrived, beside an `origin.txt` naming where it came from.
 */
export function standInRecycleBin(folder: string): TrashItem {
  return async (path) => {
    await mkdir(folder, { recursive: true })
    const slot = join(folder, `${(await readdir(folder)).length}-${basename(path)}`)
    await mkdir(slot)
    await rename(path, join(slot, basename(path)))
    await writeFile(join(slot, ORIGIN), path)
  }
}

/** The original paths of everything in a stand-in Recycle Bin, oldest first. */
export async function standInContents(folder: string): Promise<string[]> {
  const slots = (await readdir(folder)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  return Promise.all(slots.map((slot) => readFile(join(folder, slot, ORIGIN), 'utf8')))
}
