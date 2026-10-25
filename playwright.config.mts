import { defineConfig } from '@playwright/test'

// Seam 2: end-to-end journeys through the built app (run `npm run build` first;
// `npm run test:seam2` does both), each on its own fake environment.
export default defineConfig({
  testDir: 'test/seam2',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' }
})
