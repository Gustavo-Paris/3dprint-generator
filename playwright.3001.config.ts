import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'workspace-responsive.spec.ts',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
