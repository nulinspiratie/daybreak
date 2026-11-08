import { defineProject } from 'vitest/config'

// Component tests opt in to a DOM with `// @vitest-environment happy-dom`; the rest stay in node.
export default defineProject({
  test: { name: 'web', environment: 'node', include: ['test/**/*.test.{ts,tsx}'] },
})
