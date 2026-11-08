import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

export const COOKIE_NAME = 'daybreak_token'

/** Constant-time string comparison (hashes first so lengths match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function hostAllowed(host: string | undefined, port: number, extraHosts: string[] = []): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || (host !== undefined && extraHosts.includes(host))
}

export function hostGuard(port: number, extraHosts: string[] = []): MiddlewareHandler {
  return async (c, next) => {
    if (!hostAllowed(c.req.header('host'), port, extraHosts)) return c.json({ error: 'forbidden', message: 'Bad Host header' }, 403)
    await next()
  }
}

export function tokenGuard(token: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header('authorization') ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const cookie = getCookie(c, COOKIE_NAME) ?? ''
    if (!(bearer && safeEqual(bearer, token)) && !(cookie && safeEqual(cookie, token))) {
      return c.json({ error: 'unauthorized', message: 'Missing or invalid token' }, 401)
    }
    await next()
  }
}
