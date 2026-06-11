import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    setupFiles: ['tests/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      // Gate only the well-tested core libs (mesh/flexify/3mf); the rest of src
      // is exercised by integration/E2E and intentionally un-gated for now.
      include: ['src/lib/mesh/**', 'src/lib/flexify/**', 'src/lib/3mf/**'],
      // Floor measured 2026-06-11 (stmts 79.2 / branch 74.7 / fn 84.3 / lines 81.8)
      // minus a small margin so CI gates regressions without flaking.
      thresholds: {
        lines: 78,
        functions: 80,
        branches: 71,
        statements: 76,
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
