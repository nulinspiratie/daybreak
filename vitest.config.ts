process.env.TZ = 'Europe/Copenhagen'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/server', 'apps/web'],
  },
})
