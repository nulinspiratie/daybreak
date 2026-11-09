import { describe, expect, it, vi } from 'vitest'
import { TEST_PORT, TEST_TOKEN, testApp } from './helpers'

async function readUntil(reader: { read(): Promise<{ value?: Uint8Array; done: boolean }> }, needle: string): Promise<string> {
  const dec = new TextDecoder()
  let text = ''
  while (!text.includes(needle)) {
    const { value, done } = await reader.read()
    if (done) break
    text += dec.decode(value)
  }
  return text
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(cond()).toBe(true)
}

/** The stream opens with a comment, so a browser sees it open before any event (Bun sends the headers with the first bytes). */
async function opened(res: Response) {
  const reader = res.body!.getReader()
  expect(await readUntil(reader, '\n\n')).toBe(': connected\n\n')
  return reader
}

describe('GET /events/stream', () => {
  it('opens with a comment before any event', async () => {
    const { req } = await testApp()
    const res = await req('/events/stream')
    const reader = await opened(res)
    await reader.cancel()
  })

  it('streams "changed" after a POST /api/tasks', async () => {
    const { req, broker } = await testApp()
    const res = await req('/events/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    await until(() => broker.listenerCount === 1)
    const post = await req('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Write report', section: 'inbox' }),
    })
    expect(post.status).toBeLessThan(300)
    const reader = await opened(res)
    const text = await readUntil(reader, '\n\n')
    expect(text).toBe('event: changed\ndata: {}\n\n')
    await reader.cancel()
  })

  it('streams day_changed with the new date', async () => {
    const { req, broker } = await testApp()
    const res = await req('/events/stream')
    await until(() => broker.listenerCount === 1)
    broker.publish('day_changed', { today: '2026-11-11' })
    const reader = await opened(res)
    expect(await readUntil(reader, '\n\n')).toBe('event: day_changed\ndata: {"today":"2026-11-11"}\n\n')
    await reader.cancel()
  })

  it('requires auth', async () => {
    const { app } = await testApp()
    const res = await app.request('http://x/events/stream', { headers: { Host: `127.0.0.1:${TEST_PORT}` } })
    expect(res.status).toBe(401)
    const ok = await app.request('http://x/events/stream', {
      headers: { Host: `127.0.0.1:${TEST_PORT}`, Authorization: `Bearer ${TEST_TOKEN}` },
    })
    expect(ok.status).toBe(200)
    await ok.body!.cancel()
  })

  it('unsubscribes from the broker when the client disconnects', async () => {
    const { req, broker } = await testApp()
    const res = await req('/events/stream')
    await until(() => broker.listenerCount === 1)
    await res.body!.cancel()
    await until(() => broker.listenerCount === 0)
  })

  it('sends a ": ping" comment every 25 s and stops after disconnect', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const { req, broker } = await testApp()
      const res = await req('/events/stream')
      await until(() => broker.listenerCount === 1)
      const reader = await opened(res)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(25_000)
      expect(await readUntil(reader, '\n\n')).toBe(': ping\n\n')
      await reader.cancel()
      await until(() => vi.getTimerCount() === 0)
    } finally {
      vi.useRealTimers()
    }
  })
})
