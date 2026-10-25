import { defineConfig } from 'vitest/config'

// Seam 1: the typed backend API, driven in Node against the fake environment.
export default defineConfig({
  test: {
    include: ['test/seam1/**/*.test.ts'],
    testTimeout: 20_000
  }
})
