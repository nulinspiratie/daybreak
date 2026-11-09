import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, Unreachable } from '../src/api/client'

const sent: RequestInit[] = []
function answer(res: () => Promise<Response>) {
  sent.length = 0
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init: RequestInit) => {
    sent.push(init)
    return res()
  }))
}
const contentType = (init: RequestInit) => new Headers(init.headers).get('content-type')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('sends Content-Type: application/json on every write, bodiless POSTs included', async () => {
    answer(async () => new Response(null, { status: 204 }))
    await api.send('POST', '/api/review/2026-11-10/undo')
    await api.send('POST', '/api/tasks/abc/open-link')
    await api.send('DELETE', '/api/tasks/abc')
    await api.send('PATCH', '/api/tasks/abc', { title: 'x' })
    expect(sent.map(contentType)).toEqual(['application/json', 'application/json', 'application/json', 'application/json'])
    expect(sent[3]!.body).toBe('{"title":"x"}')
    expect(sent[0]!.body).toBeUndefined()
  })

  it('a GET sends no Content-Type', async () => {
    answer(async () => Response.json({ ok: true }))
    await api.get('/api/ping')
    expect(contentType(sent[0]!)).toBeNull()
  })

  it('an error answer is an ApiError with the server message', async () => {
    answer(async () => Response.json({ error: 'invalid', message: 'This task has no link' }, { status: 400 }))
    const e = await api.send('POST', '/api/tasks/abc/open-link').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ status: 400, code: 'invalid', message: 'This task has no link' })
  })

  it('a fetch that fails (server not running) is Unreachable', async () => {
    answer(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(api.send('PATCH', '/api/tasks/abc', { title: 'x' })).rejects.toBeInstanceOf(Unreachable)
  })
})
