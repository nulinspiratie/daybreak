import type { Daybreak, ReviewChoice } from '@daybreak/core'
import { Hono } from 'hono'
import { dateParam, isDate, isString, maybe, need, oneOf, readBody } from '../validate'

const isChoice = oneOf<ReviewChoice>('today', 'day', 'backlog', 'cancel', 'done')

export function reviewRoutes(d: Daybreak): Hono {
  const app = new Hono()
  const date = (c: { req: { param(k: string): string } }) => dateParam(c.req.param('date'), 'date')

  app.get('/:date', (c) => c.json(d.review(date(c))))

  app.post('/:date/decide', async (c) => {
    const day = date(c)
    const b = await readBody(c)
    return c.json(
      d.decide(
        day,
        need(b, 'taskId', isString, 'a task id'),
        need(b, 'choice', isChoice, '"today", "day", "backlog", "cancel" or "done"'),
        maybe(b, 'targetDate', isDate, 'a date as YYYY-MM-DD'),
      ),
    )
  })

  app.post('/:date/undo', (c) => c.json(d.undoDecision(date(c))))
  app.post('/:date/skip', (c) => {
    d.skipReview(date(c))
    return c.body(null, 204)
  })
  app.post('/:date/finish', (c) => {
    d.finishReview(date(c))
    return c.body(null, 204)
  })
  return app
}
