import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDaybreak, fixedClock, migrate, openDatabase } from '@daybreak/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { ChangeBroker } from '../src/sse'
import { readStatic } from '../src/static'
import { TEST_PORT, TEST_TOKEN } from './helpers'

let dist: string
let request: (path: string, host?: string) => Promise<Response>

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'daybreak-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><title>Built</title><div id="root"></div>',
  )
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dist, '..', 'daybreak-secret.txt'), 'secret')
  const db = await openDatabase(':memory:')
  migrate(db)
  const daybreak = createDaybreak({
    db,
    clock: fixedClock('2026-11-10T09:00:00Z'),
    config: { dayStartsAt: '04:00' },
  })
  const app = createApp({
    daybreak,
    token: TEST_TOKEN,
    port: TEST_PORT,
    dayStartsAt: '04:00',
    broker: new ChangeBroker(),
    webDist: dist,
  })
  request = (path, host = `127.0.0.1:${TEST_PORT}`) =>
    Promise.resolve(
      app.request(`http://127.0.0.1:${TEST_PORT}${path}`, { headers: { Host: host } }),
    )
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
  rmSync(join(dist, '..', 'daybreak-secret.txt'), { force: true })
})

describe('static web app', () => {
  it('serves index.html at / and sets the token cookie', async () => {
    const res = await request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>Built</title>')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`daybreak_token=${TEST_TOKEN}`)
    expect(cookie).toContain('HttpOnly')
  })

  it('serves assets without a token, with a content type', async () => {
    const res = await request('/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log(1)')
    expect(res.headers.get('content-type')).toMatch(/javascript/)
  })

  it('still applies the Host check to assets', async () => {
    expect((await request('/assets/app.js', 'evil.example:47815')).status).toBe(403)
  })

  it('404s for missing files and does not escape the dist folder', async () => {
    expect((await request('/assets/nope.js')).status).toBe(404)
    expect((await request('/assets/..%2f..%2fdaybreak-secret.txt')).status).toBe(404)
    expect((await request('/../daybreak-secret.txt')).status).toBe(404)
  })

  it('readStatic rejects traversal, including encoded forms', () => {
    expect(readStatic(dist, '/../daybreak-secret.txt')).toBeNull()
    expect(readStatic(dist, '/%2e%2e/daybreak-secret.txt')).toBeNull()
    expect(readStatic(dist, '/assets/..%2f..%2fdaybreak-secret.txt')).toBeNull()
    expect(readStatic(dist, '/assets/app.js')).not.toBeNull()
  })
})

describe('placeholder', () => {
  async function rootBody(webDist?: string): Promise<string> {
    const db = await openDatabase(':memory:')
    migrate(db)
    const daybreak = createDaybreak({
      db,
      clock: fixedClock('2026-11-10T09:00:00Z'),
      config: { dayStartsAt: '04:00' },
    })
    const app = createApp({
      daybreak,
      token: TEST_TOKEN,
      port: TEST_PORT,
      dayStartsAt: '04:00',
      broker: new ChangeBroker(),
      webDist,
    })
    const res = await app.request(`http://127.0.0.1:${TEST_PORT}/`, {
      headers: { Host: `127.0.0.1:${TEST_PORT}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('daybreak_token=')
    return res.text()
  }

  it('is served when webDist is unset', async () => {
    expect(await rootBody()).toContain('Daybreak server is running')
  })

  it('is served when webDist does not exist', async () => {
    expect(await rootBody(join(tmpdir(), 'daybreak-no-such-dist'))).toContain(
      'Daybreak server is running',
    )
  })

  it('is served when index.html is missing from webDist', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'daybreak-empty-'))
    try {
      expect(await rootBody(empty)).toContain('Daybreak server is running')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
