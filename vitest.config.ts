process.env.TZ = 'Europe/Copenhagen'

import { defineConfig } from 'vitest/config'

// Add `packages/server` and `apps/web` here when those packages exist.
export default defineConfig({
  test: {
    projects: ['packages/core'],
  },
})
