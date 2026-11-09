import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { ChangeBroker } from '../src/sse'
import { TEST_PORT, TEST_TOKEN, testApp } from './helpers'

const SELF = `http://127.0.0.1:${TEST_PORT}`
const JSON_TYPE = { 'Content-Type': 'application/json' }
const create = (
  headers: Record<string, string>,
  body: unknown = { title: 'From a page', section: 'inbox' },
): RequestInit => ({
  method: 'POST',
  headers,
  body: JSON.stringify(body),
})

describe('writes are same-origin only', () => {
  it('403 for a POST from another origin, the server keeping its usual error shape', async () => {
    const { req, daybreak } = await testApp()
    const before = daybreak.tree('all').inbox.length
    for (const headers of <Record<string, string>[]>[
      { Origin: 'http://localhost:8888', 'Sec-Fetch-Site': 'same-site' }, // another local tool: same site, other port
      { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'https://evil.example' }, // a browser without Sec-Fetch-Site
      { 'Sec-Fetch-Site': 'cross-site' }, // no Origin
      { Origin: 'null' },
      { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-origin' }, // the dev origin, but not in dev
    ]) {
      const res = await req('/api/tasks', create({ ...JSON_TYPE, ...headers }))
      expect(res.status, JSON.stringify(headers)).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden', message: expect.any(String) })
    }
    expect(daybreak.tree('all').inbox.length).toBe(before)
  })

  it('403 for bodiless writes too (finish, undo, delete) from another origin', async () => {
    const { req } = await testApp({ seed: true })
    const cross = { Origin: 'http://localhost:8888', 'Sec-Fetch-Site': 'same-site' }
    expect(
      (await req('/api/review/2026-11-10/finish', { method: 'POST', headers: cross })).status,
    ).toBe(403)
    expect(
      (await req('/api/review/2026-11-10/undo', { method: 'POST', headers: cross })).status,
    ).toBe(403)
    expect((await req('/api/tasks/zzzzzz', { method: 'DELETE', headers: cross })).status).toBe(403)
  })

  it('a same-origin POST passes, from 127.0.0.1 or localhost, and so does a client that sends neither header', async () => {
    const { req } = await testApp()
    const same = await req(
      '/api/tasks',
      create({ ...JSON_TYPE, Origin: SELF, 'Sec-Fetch-Site': 'same-origin' }),
    )
    expect(same.status).toBe(201)
    const local = await req(
      '/api/tasks',
      create({
        ...JSON_TYPE,
        Host: `localhost:${TEST_PORT}`,
        Origin: `http://localhost:${TEST_PORT}`,
      }),
    )
    expect(local.status).toBe(201)
    expect(
      (await req('/api/tasks', create({ ...JSON_TYPE, 'Sec-Fetch-Site': 'none' }))).status,
    ).toBe(201)
    expect((await req('/api/tasks', create(JSON_TYPE))).status).toBe(201) // e.g. the CLI
  })

  it('in dev the Vite origin may write; other ports still may not', async () => {
    const { daybreak } = await testApp()
    const app = createApp({
      daybreak,
      token: TEST_TOKEN,
      port: TEST_PORT,
      dayStartsAt: '04:00',
      broker: new ChangeBroker(),
      extraHosts: ['localhost:5173', '127.0.0.1:5173'],
    })
    const send = (origin: string) =>
      app.request(
        `${SELF}/api/tasks`,
        create({
          ...JSON_TYPE,
          Host: 'localhost:5173',
          Authorization: `Bearer ${TEST_TOKEN}`,
          Origin: origin,
          'Sec-Fetch-Site': 'same-origin',
        }),
      )
    expect((await send('http://localhost:5173')).status).toBe(201)
    expect((await send('http://127.0.0.1:5173')).status).toBe(201)
    expect((await send('http://localhost:8888')).status).toBe(403)
    // Any website the user visits while `bun run dev` runs: the proxy adds the token, this check still holds.
    const site = await app.request(
      `${SELF}/api/tasks`,
      create({
        ...JSON_TYPE,
        Host: 'localhost:5173',
        Authorization: `Bearer ${TEST_TOKEN}`,
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      }),
    )
    expect(site.status).toBe(403)
  })

  it('GETs are unaffected', async () => {
    const { req } = await testApp()
    const res = await req('/api/tree', {
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(res.status).toBe(200)
  })
})

describe('JSON bodies need Content-Type: application/json', () => {
  it('403 for a text/plain POST (a CORS simple request), even same-origin', async () => {
    const { req, daybreak } = await testApp()
    for (const type of [
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
    ]) {
      const res = await req(
        '/api/tasks',
        create({ 'Content-Type': type, Origin: SELF, 'Sec-Fetch-Site': 'same-origin' }),
      )
      expect(res.status, type).toBe(403)
      expect(await res.json()).toEqual({
        error: 'forbidden',
        message: 'Content-Type must be application/json',
      })
    }
    const none = await req('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'x', section: 'inbox' }),
    })
    expect(none.status).toBe(403)
    expect(daybreak.tree('all').inbox).toHaveLength(0)
  })

  it('accepts application/json with parameters', async () => {
    const { req } = await testApp()
    const res = await req(
      '/api/tasks',
      create({ 'Content-Type': 'Application/JSON; charset=utf-8' }),
    )
    expect(res.status).toBe(201)
  })
})
