import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built Electron app (out/main/index.js), so run
// `npx electron-vite build` first. Under Linux CI they run inside xvfb-run.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/artifacts',
  use: {
    trace: 'off'
  }
})
