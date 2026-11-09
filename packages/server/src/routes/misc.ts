import type { Daybreak } from '@daybreak/core'
import { Hono } from 'hono'
import type { BackupStatus } from '../backup'
import { invalid } from '../validate'

const COMPLETED = ['recent', 'all', 'none'] as const

export function miscRoutes(
  d: Daybreak,
  dayStartsAt: string,
  backupStatus?: () => BackupStatus,
): Hono {
  const app = new Hono()

  app.get('/status', (c) =>
    c.json({
      today: d.today(),
      needsReview: d.needsReview(),
      dayStartsAt,
      backup: backupStatus?.() ?? null,
    }),
  )

  app.get('/tree', (c) => {
    const completed = c.req.query('completed') ?? 'recent'
    if (!(COMPLETED as readonly string[]).includes(completed)) {
      throw invalid('completed must be recent, all or none')
    }
    return c.json(d.tree(completed as (typeof COMPLETED)[number]))
  })

  app.get('/projects/:id/export.md', (c) =>
    c.body(d.exportProject(c.req.param('id')), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
    }),
  )

  return app
}
