import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Daybreak } from '@daybreak/core'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { COOKIE_NAME, hostGuard, originGuard, tokenGuard } from './auth'
import { errorResponse } from './errors'
import { openLink } from './openLink'
import { dayRoutes } from './routes/day'
import { miscRoutes } from './routes/misc'
import { reviewRoutes } from './routes/review'
import { taskRoutes } from './routes/tasks'
import { type ChangeBroker, eventRoutes } from './sse'
import { readStatic } from './static'
import { invalid, isString, need, readBody } from './validate'

export interface AppDeps {
  daybreak: Daybreak
  token: string
  port: number
  dayStartsAt: string
  broker: ChangeBroker
  /** Extra allowed Host values (the Vite dev server). */
  extraHosts?: string[]
  /** Defaults to the real OS opener; tests inject a spy. */
  openLink?: (link: string) => void
  webDist?: string
}

const PLACEHOLDER =
  '<!doctype html><meta charset="utf-8"><title>Daybreak</title><p>Daybreak server is running.</p>'

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const host = hostGuard(deps.port, deps.extraHosts)
  const token = tokenGuard(deps.token)

  app.onError(errorResponse)

  app.use('/api/*', host, token, originGuard(deps.port, deps.extraHosts))
  app.use('/events/*', host, token)

  app.get('/api/ping', (c) => c.json({ ok: true }))

  // Links in rendered notes. Only web and mail links, parsed (a task's own link may be a path, notes text may not).
  app.post('/api/open-link', async (c) => {
    const target = need(await readBody(c), 'target', isString, 'a string')
    // Whitespace, control characters and quotes would reach explorer.exe's own command-line parsing.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
    if (/[\u0000-\u0020\u007f"]/.test(target))
      throw invalid('Link contains a space, control character or quote')
    let url: URL
    try {
      url = new URL(target)
    } catch {
      throw invalid('Not a valid link')
    }
    if (
      !['http:', 'https:', 'mailto:'].includes(url.protocol) ||
      (url.protocol !== 'mailto:' && url.hostname === '')
    ) {
      throw invalid('Only http, https and mailto links can be opened')
    }
    ;(deps.openLink ?? openLink)(url.href)
    return c.body(null, 204)
  })

  app.route('/api', miscRoutes(deps.daybreak, deps.dayStartsAt))
  app.route('/api', dayRoutes(deps.daybreak))
  app.route('/api/tasks', taskRoutes(deps.daybreak, deps.openLink ?? openLink))
  app.route('/api/review', reviewRoutes(deps.daybreak))
  app.route('/events', eventRoutes(deps.broker))

  app.get('/', host, (c) => {
    setCookie(c, COOKIE_NAME, deps.token, { httpOnly: true, sameSite: 'Strict', path: '/' })
    const index = deps.webDist ? join(deps.webDist, 'index.html') : undefined
    return c.html(index && existsSync(index) ? readFileSync(index, 'utf8') : PLACEHOLDER)
  })

  // Built web assets need no token (the Host check still applies).
  const webDist = deps.webDist
  if (webDist) {
    app.get('/*', host, (c) => {
      const file = readStatic(webDist, c.req.path)
      if (!file) return c.notFound()
      return c.body(new Uint8Array(file.body), 200, { 'Content-Type': file.type })
    })
  }

  return app
}
