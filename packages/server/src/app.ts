import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Daybreak } from '@daybreak/core'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { COOKIE_NAME, hostGuard, tokenGuard } from './auth'
import { errorResponse } from './errors'
import { openLink } from './openLink'
import { dayRoutes } from './routes/day'
import { miscRoutes } from './routes/misc'
import { reviewRoutes } from './routes/review'
import { taskRoutes } from './routes/tasks'

export interface AppDeps {
  daybreak: Daybreak
  token: string
  port: number
  dayStartsAt: string
  /** Defaults to the real OS opener; tests inject a spy. */
  openLink?: (link: string) => void
  webDist?: string
}

const PLACEHOLDER = '<!doctype html><meta charset="utf-8"><title>Daybreak</title><p>Daybreak server is running.</p>'

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const host = hostGuard(deps.port)
  const token = tokenGuard(deps.token)

  app.onError(errorResponse)

  app.use('/api/*', host, token)
  app.use('/events/*', host, token)

  app.get('/api/ping', (c) => c.json({ ok: true }))

  app.route('/api', miscRoutes(deps.daybreak, deps.dayStartsAt))
  app.route('/api', dayRoutes(deps.daybreak))
  app.route('/api/tasks', taskRoutes(deps.daybreak, deps.openLink ?? openLink))
  app.route('/api/review', reviewRoutes(deps.daybreak))

  app.get('/', host, (c) => {
    setCookie(c, COOKIE_NAME, deps.token, { httpOnly: true, sameSite: 'Strict', path: '/' })
    const index = deps.webDist ? join(deps.webDist, 'index.html') : undefined
    return c.html(index && existsSync(index) ? readFileSync(index, 'utf8') : PLACEHOLDER)
  })

  return app
}
