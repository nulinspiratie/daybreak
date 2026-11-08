import { describe, expect, it } from 'vitest'
import { createTask, eventsOn, getTask, lastWorkedBefore, marksOn, setMark, setStatus, today } from '../src/index'
import { DaybreakError } from '../src/index'
import { makeCtx } from './helpers'

describe('marksOn', () => {
  it('returns the marks for that date only', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const b = createTask(ctx, { title: 'b', section: 'inbox' })
    ctx.db.run("INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-10', ?, 'doing')", a.id)
    ctx.db.run("INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-09', ?, 'worked')", b.id)
    expect(marksOn(ctx, '2026-11-10')).toEqual(new Map([[a.id, 'doing']]))
    expect(marksOn(ctx, '2026-11-09')).toEqual(new Map([[b.id, 'worked']]))
    expect(marksOn(ctx, '2026-11-08').size).toBe(0)
  })

  it('ignores deleted tasks', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    ctx.db.run("INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-10', ?, 'doing')", a.id)
    ctx.db.run("UPDATE tasks SET deleted_at = '2026-11-10T00:00:00Z' WHERE id = ?", a.id)
    expect(marksOn(ctx, '2026-11-10').size).toBe(0)
  })
})

describe('setMark', () => {
  it('only one doing', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const b = createTask(ctx, { title: 'b', section: 'inbox' })
    setMark(ctx, a.id, 'doing')
    setMark(ctx, b.id, 'doing')
    expect(marksOn(ctx, today(ctx))).toEqual(new Map([[a.id, 'worked'], [b.id, 'doing']]))
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'worked')
    expect(ev.map((e) => e.taskId)).toEqual([a.id])
  })

  it('doing or worked on a task not scheduled today schedules it today at the end of My Day', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const b = createTask(ctx, { title: 'b', section: 'inbox' })
    const c = createTask(ctx, { title: 'c', section: 'inbox' })
    setMark(ctx, a.id, 'doing')
    setMark(ctx, b.id, 'worked')
    expect(getTask(ctx, a.id).scheduledOn).toBe(today(ctx))
    expect(getTask(ctx, b.id).scheduledOn).toBe(today(ctx))
    expect(getTask(ctx, a.id).dayPosition! < getTask(ctx, b.id).dayPosition!).toBe(true)
    expect(getTask(ctx, c.id).scheduledOn).toBeNull()
  })

  it('doing again on the doing task clears it; same for worked', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    setMark(ctx, a.id, 'doing')
    setMark(ctx, a.id, 'doing')
    expect(marksOn(ctx, today(ctx)).get(a.id) ?? null).toBeNull()
    setMark(ctx, a.id, 'worked')
    setMark(ctx, a.id, 'worked')
    expect(marksOn(ctx, today(ctx)).get(a.id) ?? null).toBeNull()
    expect(eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'doing' || e.kind === 'worked')).toHaveLength(2)
  })

  it('null clears the mark without an event', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    setMark(ctx, a.id, 'worked')
    setMark(ctx, a.id, null)
    expect(marksOn(ctx, today(ctx)).size).toBe(0)
    expect(eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'worked')).toHaveLength(1)
  })

  it('switching doing to worked on the same task replaces the mark', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    setMark(ctx, a.id, 'doing')
    setMark(ctx, a.id, 'worked')
    expect(marksOn(ctx, today(ctx)).get(a.id)).toBe('worked')
  })

  it('marks are per day', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    setMark(ctx, a.id, 'doing')
    const day1 = today(ctx)
    ctx.clock.set('2026-11-11T08:00:00Z')
    expect(marksOn(ctx, today(ctx)).size).toBe(0)
    expect(marksOn(ctx, day1).get(a.id)).toBe('doing')
  })

  it('throws invalid on a closed task', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    setStatus(ctx, a.id, 'done')
    expect(() => setMark(ctx, a.id, 'doing')).toThrow(DaybreakError)
    try {
      setMark(ctx, a.id, 'doing')
    } catch (e) {
      expect((e as DaybreakError).code).toBe('invalid')
    }
  })

  it('records doing and worked events with the date', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    setMark(ctx, a.id, 'doing')
    setMark(ctx, a.id, 'worked')
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'doing' || e.kind === 'worked')
    expect(ev.map((e) => [e.kind, e.data])).toEqual([
      ['doing', { date: '2026-11-10' }],
      ['worked', { date: '2026-11-10' }],
    ])
  })
})

describe('lastWorkedBefore', () => {
  it('returns the latest earlier date with a worked or doing mark', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const ins = (d: string, m: string) =>
      ctx.db.run('INSERT INTO day_marks (date, task_id, mark) VALUES (?, ?, ?)', d, a.id, m)
    expect(lastWorkedBefore(ctx, a.id, '2026-11-10')).toBeNull()
    ins('2026-11-05', 'worked')
    ins('2026-11-07', 'doing')
    ins('2026-11-10', 'worked')
    expect(lastWorkedBefore(ctx, a.id, '2026-11-10')).toBe('2026-11-07')
    expect(lastWorkedBefore(ctx, a.id, '2026-11-07')).toBe('2026-11-05')
    expect(lastWorkedBefore(ctx, a.id, '2026-11-05')).toBeNull()
  })
})
