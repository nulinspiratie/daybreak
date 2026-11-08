process.env.TZ = 'Europe/Copenhagen'

import { defineConfig } from 'vitest/config'

// Add `apps/web` here when that package exists.
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/server'],
  },
})
