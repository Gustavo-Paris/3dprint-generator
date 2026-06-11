import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    // `next dev` on the configured port; CI overrides E2E_BASE_URL to a built app it starts itself.
    command: 'pnpm dev --port 3001',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { E2E_ALLOW_TEST_LOGIN: '1' },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
