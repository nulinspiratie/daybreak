import { type Daybreak, daysBetween } from '@daybreak/core'
import { Hono } from 'hono'
import { dateParam, invalid } from '../validate'

/** Every day in the range gets an entry, built on the one server thread. */
const MAX_DAYS = 400

export function dayRoutes(d: Daybreak): Hono {
  const app = new Hono()
  app.get('/day/:date', (c) => c.json(d.day(dateParam(c.req.param('date'), 'date'))))
  app.get('/days', (c) => {
    const from = dateParam(c.req.query('from'), 'from')
    const to = dateParam(c.req.query('to'), 'to')
    if (daysBetween(from, to) > MAX_DAYS) throw invalid(`The range can span at most ${MAX_DAYS} days`)
    return c.json(d.dayCounts(from, to))
  })
  return app
}
