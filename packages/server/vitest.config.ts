import { defineProject } from 'vitest/config'

// root is the repo root so core's source (consumed via the workspace link) sits
// inside the Vite root; core's runtime-chosen `import(specifier)` of its sqlite
// driver does not resolve for files outside the root.
export default defineProject({
  root: '../..',
  test: {
    name: 'server',
    include: ['packages/server/test/**/*.test.ts'],
  },
})
