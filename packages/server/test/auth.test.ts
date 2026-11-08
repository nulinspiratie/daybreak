import { describe, expect, it } from 'vitest'
import { DaybreakError } from '@daybreak/core'
import { createApp } from '../src/app'
import { TEST_PORT, TEST_TOKEN, testApp } from './helpers'

describe('auth', () => {
  it('403 on foreign Host', async () => {
    const { req } = await testApp()
    expect((await req('/api/ping', { headers: { Host: 'evil.example:47815' } })).status).toBe(403)
    expect((await req('/events/stream', { headers: { Host: `127.0.0.1:1234` } })).status).toBe(403)
    expect((await req('/', { headers: { Host: 'evil.example:47815' } })).status).toBe(403)
  })
  it('401 without token', async () => {
    const { app } = await testApp()
    const res = await app.request('http://x/api/ping', { headers: { Host: `127.0.0.1:${TEST_PORT}` } })
    expect(res.status).toBe(401)
    const bad = await app.request('http://x/api/ping', {
      headers: { Host: `127.0.0.1:${TEST_PORT}`, Authorization: `Bearer ${'b'.repeat(64)}` },
    })
    expect(bad.status).toBe(401)
    const short = await app.request('http://x/api/ping', {
      headers: { Host: `127.0.0.1:${TEST_PORT}`, Authorization: 'Bearer x' },
    })
    expect(short.status).toBe(401)
  })
  it('200 with Bearer', async () => {
    const { req } = await testApp()
    expect((await req('/api/ping')).status).toBe(200)
    expect((await req('/api/ping', { headers: { Host: `localhost:${TEST_PORT}` } })).status).toBe(200)
  })
  it('200 with cookie', async () => {
    const { app } = await testApp()
    const res = await app.request('http://x/api/ping', {
      headers: { Host: `127.0.0.1:${TEST_PORT}`, Cookie: `other=1; daybreak_token=${TEST_TOKEN}` },
    })
    expect(res.status).toBe(200)
  })
  it('GET / sets the HttpOnly SameSite=Strict cookie', async () => {
    const { req } = await testApp()
    const res = await req('/', { headers: { Authorization: '' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`daybreak_token=${TEST_TOKEN}`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(cookie).toMatch(/Path=\//)
  })
  it('DaybreakError maps to status and JSON body', async () => {
    const { daybreak } = await testApp()
    const app = createApp({ daybreak, token: TEST_TOKEN, port: TEST_PORT })
    const mapped = [
      ['not_found', 404],
      ['invalid', 400],
      ['needs_confirmation', 409],
    ] as const
    for (const [code] of mapped) {
      app.get(`/api/boom-${code}`, () => {
        throw new DaybreakError(code, `msg ${code}`, { id: 'abc' })
      })
    }
    for (const [code, status] of mapped) {
      const res = await app.request(`http://x/api/boom-${code}`, {
        headers: { Host: `127.0.0.1:${TEST_PORT}`, Authorization: `Bearer ${TEST_TOKEN}` },
      })
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: code, message: `msg ${code}`, details: { id: 'abc' } })
    }
  })
})
