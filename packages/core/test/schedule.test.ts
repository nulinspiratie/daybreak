import { describe, expect, it } from 'vitest'
import { createTask, dayCounts, dayView, eventsOn, getTask, schedule, scheduleToday } from '../src/index'
import { build, makeCtx } from './helpers'

const D = '2026-11-10'

async function setup() {
  const ctx = await makeCtx()
  const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c\ninbox:\n  x\n  y')
  return { ctx, ids }
}

const order = (ctx: Awaited<ReturnType<typeof makeCtx>>, date = D) =>
  dayView(ctx, date).items.map((i) => i.task.title)

describe('schedule', () => {
  it('appends to the end of that day', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.b!, D)
    schedule(ctx, ids.c!, D)
    expect(order(ctx)).toEqual(['a', 'b', 'c'])
    expect(getTask(ctx, ids.a!).scheduledOn).toBe(D)
  })

  it('afterId and beforeId position within the day', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.b!, D)
    schedule(ctx, ids.c!, D, { afterId: ids.a! })
    expect(order(ctx)).toEqual(['a', 'c', 'b'])
    schedule(ctx, ids.x!, D, { beforeId: ids.a! })
    expect(order(ctx)).toEqual(['x', 'a', 'c', 'b'])
  })

  it('rejects a reference that is not scheduled on that date', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, '2026-11-11')
    expect(() => schedule(ctx, ids.b!, D, { afterId: ids.a! })).toThrow(/not scheduled/)
    expect(getTask(ctx, ids.b!).scheduledOn).toBeNull()
  })

  it('rejects an invalid date', async () => {
    const { ctx, ids } = await setup()
    for (const bad of ['tomorrow', '2026-02-30', '2026-1-1']) {
      expect(() => schedule(ctx, ids.a!, bad)).toThrow(expect.objectContaining({ code: 'invalid' }))
    }
  })

  it('schedule null clears scheduled_on and day_position', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    const t = schedule(ctx, ids.a!, null)
    expect(t.scheduledOn).toBeNull()
    expect(t.dayPosition).toBeNull()
    const ev = eventsOn(ctx, D).filter((e) => e.kind === 'unscheduled')
    expect(ev.map((e) => e.data)).toEqual([{ from: D }])
    schedule(ctx, ids.a!, null)
    expect(eventsOn(ctx, D).filter((e) => e.kind === 'unscheduled')).toHaveLength(1)
  })

  it('rescheduling to the same day with a position only reorders', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.b!, D)
    schedule(ctx, ids.c!, D)
    const before = eventsOn(ctx, D).length
    schedule(ctx, ids.c!, D, { beforeId: ids.a! })
    expect(order(ctx)).toEqual(['c', 'a', 'b'])
    schedule(ctx, ids.a!, D, { afterId: ids.b! })
    expect(order(ctx)).toEqual(['c', 'b', 'a'])
    expect(eventsOn(ctx, D).length).toBe(before)
  })

  it('same date without a position is a no-op', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.b!, D)
    const a = getTask(ctx, ids.a!)
    const before = eventsOn(ctx, D).length
    schedule(ctx, ids.a!, D)
    scheduleToday(ctx, ids.a!)
    expect(getTask(ctx, ids.a!)).toEqual(a)
    expect(eventsOn(ctx, D).length).toBe(before)
  })

  it('scheduled event has {from, to}', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.a!, '2026-11-12')
    const ev = eventsOn(ctx, D).filter((e) => e.kind === 'scheduled')
    expect(ev.map((e) => e.data)).toEqual([
      { from: null, to: D },
      { from: D, to: '2026-11-12' },
    ])
  })

  it('scheduleToday appends to today', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    scheduleToday(ctx, ids.b!)
    expect(order(ctx)).toEqual(['a', 'b'])
  })

  it('allows scheduling a closed task', async () => {
    const { ctx, ids } = await setup()
    ctx.db.run("UPDATE tasks SET status = 'done', closed_at = ? WHERE id = ?", '2026-11-10T01:00:00Z', ids.a!)
    expect(schedule(ctx, ids.a!, D).scheduledOn).toBe(D)
  })
})

describe('dayView', () => {
  it('lists in day order with paths and today\'s marks', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.b!, D)
    schedule(ctx, ids.x!, D)
    schedule(ctx, ids.a!, D, { beforeId: ids.b! })
    ctx.db.run("INSERT INTO day_marks (date, task_id, mark) VALUES (?, ?, 'doing')", D, ids.b!)
    const v = dayView(ctx, D)
    expect(v.date).toBe(D)
    expect(v.items.map((i) => [i.task.title, i.path, i.mark])).toEqual([
      ['a', ['P'], null],
      ['b', ['P'], 'doing'],
      ['x', ['Inbox'], null],
    ])
  })

  it('done stays listed; cancelled is listed but not counted', async () => {
    const { ctx, ids } = await setup()
    for (const k of ['a', 'b', 'c']) schedule(ctx, ids[k]!, D)
    ctx.db.run("UPDATE tasks SET status = 'done', closed_at = '2026-11-10T01:00:00Z' WHERE id = ?", ids.a!)
    ctx.db.run("UPDATE tasks SET status = 'cancelled', closed_at = '2026-11-10T01:00:00Z' WHERE id = ?", ids.b!)
    const v = dayView(ctx, D)
    expect(v.items).toHaveLength(3)
    expect(v.doneCount).toBe(1)
    expect(v.totalCount).toBe(2)
  })

  it('a parent scheduled today shows alone with done/total of its subtree', async () => {
    const { ctx, ids } = await setup()
    ctx.db.run("UPDATE tasks SET status = 'done', closed_at = '2026-11-10T01:00:00Z' WHERE id = ?", ids.a!)
    ctx.db.run("UPDATE tasks SET status = 'cancelled', closed_at = '2026-11-10T01:00:00Z' WHERE id = ?", ids.b!)
    schedule(ctx, ids.P!, D)
    const v = dayView(ctx, D)
    expect(v.items).toHaveLength(1)
    expect(v.items[0]!.task.title).toBe('P')
    expect(v.items[0]!.doneCount).toBe(1)
    expect(v.items[0]!.totalCount).toBe(2)
  })

  it('deleted tasks are excluded', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.b!, D)
    ctx.db.run("UPDATE tasks SET deleted_at = '2026-11-10T02:00:00Z' WHERE id = ?", ids.a!)
    expect(order(ctx)).toEqual(['b'])
  })
})

describe('dayCounts', () => {
  it('counts open live tasks per date in range', async () => {
    const { ctx, ids } = await setup()
    schedule(ctx, ids.a!, '2026-11-10')
    schedule(ctx, ids.b!, '2026-11-10')
    schedule(ctx, ids.c!, '2026-11-12')
    schedule(ctx, ids.x!, '2026-11-12')
    schedule(ctx, ids.y!, '2026-11-20')
    ctx.db.run("UPDATE tasks SET status = 'done', closed_at = '2026-11-10T01:00:00Z' WHERE id = ?", ids.b!)
    ctx.db.run("UPDATE tasks SET deleted_at = '2026-11-10T02:00:00Z' WHERE id = ?", ids.x!)
    createTask(ctx, { title: 'late', section: 'inbox', scheduledOn: '2026-11-09' })
    expect(dayCounts(ctx, '2026-11-10', '2026-11-13')).toEqual({
      '2026-11-10': 1,
      '2026-11-11': 0,
      '2026-11-12': 1,
      '2026-11-13': 0,
    })
  })
})
