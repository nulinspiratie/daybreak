import type { Daybreak } from '@daybreak/core'
import { Hono } from 'hono'
import { dateParam } from '../validate'

export function dayRoutes(d: Daybreak): Hono {
  const app = new Hono()
  app.get('/day/:date', (c) => c.json(d.day(dateParam(c.req.param('date'), 'date'))))
  app.get('/days', (c) =>
    c.json(d.dayCounts(dateParam(c.req.query('from'), 'from'), dateParam(c.req.query('to'), 'to'))),
  )
  return app
}
