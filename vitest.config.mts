import { defineConfig } from 'vitest/config'

// Seam 1: the typed backend API, driven in Node against the fake environment. Beside it, the
// interface's pieces that no window shows yet, rendered to markup in Node (test/views).
export default defineConfig({
  test: {
    include: ['test/seam1/**/*.test.ts', 'test/views/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
    // Setting up the fake environment (fixture copies, git worktrees) can outlast 10 s on a busy machine.
    hookTimeout: 20_000
  }
})
