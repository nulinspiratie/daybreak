import { describe, expect, it } from 'vitest'
import { DaybreakError, eventsOn, eventsSince, newId, nowIso, recordEvent, today } from '../src/index'
import { makeCtx } from './helpers'

describe('events', () => {
  it('recordEvent stamps at and the 04:00-shifted date', async () => {
    const ctx = await makeCtx('2026-11-10T01:00:00Z') // 02:00 local
    const row = recordEvent(ctx, 'created', 'abc123')
    expect(row.at).toBe('2026-11-10T01:00:00.000Z')
    expect(row.date).toBe('2026-11-09')
    expect(row.taskId).toBe('abc123')
    expect(row.kind).toBe('created')
    expect(nowIso(ctx)).toBe(row.at)
    expect(today(ctx)).toBe('2026-11-09')
  })

  it('data round-trips as JSON', async () => {
    const ctx = await makeCtx()
    const row = recordEvent(ctx, 'moved', 't1', { from: null, ids: ['a', 'b'], n: 2 })
    expect(row.data).toEqual({ from: null, ids: ['a', 'b'], n: 2 })
    expect(eventsOn(ctx, row.date)[0]!.data).toEqual(row.data)
    expect(recordEvent(ctx, 'done', null).data).toEqual({})
  })

  it('eventsOn returns only that date in id order', async () => {
    const ctx = await makeCtx('2026-11-10T08:00:00Z')
    const a = recordEvent(ctx, 'created', 'a')
    const b = recordEvent(ctx, 'done', 'a')
    ctx.clock.set('2026-11-11T08:00:00Z')
    const c = recordEvent(ctx, 'reopened', 'a')
    expect(eventsOn(ctx, '2026-11-10').map((e) => e.id)).toEqual([a.id, b.id])
    expect(eventsOn(ctx, '2026-11-11').map((e) => e.id)).toEqual([c.id])
    expect(eventsSince(ctx, '2026-11-11').map((e) => e.id)).toEqual([c.id])
    expect(eventsSince(ctx, '2026-11-10').map((e) => e.id)).toEqual([a.id, b.id, c.id])
  })
})

describe('ids and errors', () => {
  it('newId matches /^[0-9a-z]{6}$/', () => {
    for (let i = 0; i < 50; i++) expect(newId()).toMatch(/^[0-9a-z]{6}$/)
  })
  it('DaybreakError carries code and details', () => {
    const e = new DaybreakError('not_found', 'no such task', { id: 'x' })
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('not_found')
    expect(e.details).toEqual({ id: 'x' })
    expect(e.message).toBe('no such task')
  })
})
