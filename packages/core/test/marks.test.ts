import { describe, expect, it } from 'vitest'
import { createTask, marksOn } from '../src/index'
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
