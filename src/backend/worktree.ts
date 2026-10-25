import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

/** The Project a folder belongs to, and the worktree's name when the folder is a git worktree of it. */
export interface ProjectOf {
  project: string
  worktree: string | null
}

// Where Claude Code puts the worktrees it creates (`claude --worktree`, the desktop app).
const CLAUDE_WORKTREE = /^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)[\\/]?$/

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * A git worktree's `.git` is a file pointing at `<repo>/.git/worktrees/<name>`, whose
 * `commondir` leads back to the main repository's `.git`: the Project is the folder holding it.
 */
async function fromGit(folder: string): Promise<string | null> {
  const link = /^gitdir:\s*(.+?)\s*$/m.exec((await readText(resolve(folder, '.git'))) ?? '')
  if (!link) return null
  const gitDir = resolve(folder, link[1]!)
  const commonDir = resolve(gitDir, ((await readText(resolve(gitDir, 'commondir'))) ?? '../..').trim())
  return basename(commonDir).toLowerCase() === '.git' ? dirname(commonDir) : null
}

/** Finds the Project of the folder a Session runs in, even once its worktree is removed. */
export async function projectOf(folder: string): Promise<ProjectOf> {
  const project = await fromGit(folder)
  if (project) return { project, worktree: basename(folder) }
  const claudeWorktree = CLAUDE_WORKTREE.exec(folder)
  if (claudeWorktree) return { project: claudeWorktree[1]!, worktree: claudeWorktree[2]! }
  return { project: folder, worktree: null }
}
