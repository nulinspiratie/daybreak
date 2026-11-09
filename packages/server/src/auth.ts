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

/** Methods that change nothing; every other method is a write. */
const SAFE_METHODS = new Set(['GET', 'HEAD'])

/**
 * Writes only from the app's own pages: the cookie also rides along on requests from any other
 * page on 127.0.0.1 or localhost (cookies ignore the port), and the dev proxy adds the token to
 * whatever reaches it. A browser always says where a write comes from, in Origin and, in current
 * browsers, Sec-Fetch-Site; each one sent must name the app. A client that sends neither (the
 * CLI, curl) is not a browser and already needs the token.
 */
export function originGuard(port: number, extraHosts: string[] = []): MiddlewareHandler {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin')
      const site = c.req.header('sec-fetch-site')
      const ownOrigin = origin === undefined || (origin.startsWith('http://') && hostAllowed(origin.slice('http://'.length), port, extraHosts))
      const ownSite = site === undefined || site === 'same-origin' || site === 'none'
      if (!ownOrigin || !ownSite) return c.json({ error: 'forbidden', message: 'Cross-origin write refused' }, 403)
    }
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
