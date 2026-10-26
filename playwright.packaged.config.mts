import { defineConfig } from '@playwright/test'

// Journeys against a packaged ClaudeForge: CLAUDEFORGE_EXECUTABLE names its ClaudeForge.exe, for
// instance dist/win-unpacked/ClaudeForge.exe after `npm run package`. CI runs them against the
// installer it built, installed, and has the installed app update itself
// (.github/workflows/ci.yml).
export default defineConfig({
  testDir: 'test/packaged',
  timeout: 90_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' }
})
