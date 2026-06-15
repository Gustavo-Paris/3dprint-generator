import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3001'

// When E2E_BASE_URL is set (CI points it at a built `next start`), do NOT spawn
// our own dev server — test the already-running app. Locally (unset), start dev.
const webServer = process.env.E2E_BASE_URL
  ? undefined
  : {
      command: 'pnpm dev --port 3001',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { E2E_ALLOW_TEST_LOGIN: '1' },
    }

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // All e2e tests sign in as the same single allowed email and share one DB, so
  // they are not parallel-safe (Playwright still spreads files across multiple
  // workers despite fullyParallel:false). Serialize in CI.
  workers: process.env.CI ? 1 : undefined,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
