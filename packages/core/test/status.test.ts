import { describe, expect, it } from 'vitest'
import type { Ctx } from '../src/index'
import { DaybreakError, eventsOn, getTask, setMark, setStatus, today } from '../src/index'
import { build, makeCtx } from './helpers'

const TREE = `projects:
  P
    A
      A1
      A2
    B
    C
`

type Ids = Record<'P' | 'A' | 'A1' | 'A2' | 'B' | 'C', string>
const tree = (ctx: Ctx) => build(ctx, TREE) as Ids

describe('setStatus', () => {
  it('closing a leaf sets status and closed_at', async () => {
    const ctx = await makeCtx()
    const { B } = tree(ctx)
    const r = setStatus(ctx, B, 'done')
    expect(r.task.status).toBe('done')
    expect(r.task.closedAt).toBe('2026-11-10T08:00:00.000Z')
    expect(r.changedIds).toEqual([B])
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'done')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.taskId).toBe(B)
    expect(ev[0]!.data.closedIds).toEqual([B])
  })

  it('closing a task with open descendants without the flag throws needs_confirmation', async () => {
    const ctx = await makeCtx()
    const { P, C } = tree(ctx)
    setStatus(ctx, C, 'done')
    let err: unknown
    try {
      setStatus(ctx, P, 'done')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DaybreakError)
    expect((err as DaybreakError).code).toBe('needs_confirmation')
    expect((err as DaybreakError).details?.openCount).toBe(4)
    expect(getTask(ctx, P).status).toBe('open')
  })

  it('closing with withOpenDescendants closes it and only its open descendants', async () => {
    const ctx = await makeCtx()
    const { P, A, A1, A2, B, C } = tree(ctx)
    setStatus(ctx, C, 'done')
    setStatus(ctx, A2, 'cancelled')
    ctx.clock.set('2026-11-10T09:00:00Z')
    const r = setStatus(ctx, P, 'done', { withOpenDescendants: true })
    expect(r.changedIds).toEqual([P, A, A1, B])
    expect(getTask(ctx, C).closedAt).toBe('2026-11-10T08:00:00.000Z')
    expect(getTask(ctx, C).status).toBe('done')
    expect(getTask(ctx, A2).status).toBe('cancelled')
    expect(getTask(ctx, A1).status).toBe('done')
    expect(getTask(ctx, A1).closedAt).toBe('2026-11-10T09:00:00.000Z')
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.taskId === P && e.kind === 'done')
    expect(ev[0]!.data.closedIds).toEqual([P, A, A1, B])
  })

  it('reopen restores exactly the ids closed with it', async () => {
    const ctx = await makeCtx()
    const { P, A, A1, A2, B, C } = tree(ctx)
    setStatus(ctx, C, 'done')
    const r = setStatus(ctx, P, 'cancelled', { withOpenDescendants: true })
    expect(r.changedIds).toHaveLength(5)
    const re = setStatus(ctx, P, 'open')
    expect(re.changedIds).toEqual([P, A, A1, A2, B])
    for (const id of [P, A, A1, A2, B]) {
      expect(getTask(ctx, id).status).toBe('open')
      expect(getTask(ctx, id).closedAt).toBeNull()
    }
    expect(getTask(ctx, C).status).toBe('done')
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'reopened')
    expect(ev[0]!.data.ids).toEqual([P, A, A1, A2, B])
  })

  it('reopen leaves a child closed earlier on its own done', async () => {
    const ctx = await makeCtx()
    const { P, A, A1, A2, B, C } = tree(ctx)
    setStatus(ctx, A1, 'done')
    setStatus(ctx, P, 'done', { withOpenDescendants: true })
    const re = setStatus(ctx, P, 'open')
    expect(re.changedIds).toEqual([P, A, A2, B, C])
    expect(getTask(ctx, A1).status).toBe('done')
  })

  it('reopen of a task closed on its own reopens only it', async () => {
    const ctx = await makeCtx()
    const { A, A1 } = tree(ctx)
    setStatus(ctx, A1, 'done')
    setStatus(ctx, A, 'open')
    const re = setStatus(ctx, A1, 'open')
    expect(re.changedIds).toEqual([A1])
    expect(getTask(ctx, A1).status).toBe('open')
  })

  it('same status is a no-op without an event', async () => {
    const ctx = await makeCtx()
    const { B } = tree(ctx)
    expect(setStatus(ctx, B, 'open').changedIds).toEqual([])
    setStatus(ctx, B, 'done')
    const before = eventsOn(ctx, today(ctx)).length
    expect(setStatus(ctx, B, 'done').changedIds).toEqual([])
    expect(eventsOn(ctx, today(ctx))).toHaveLength(before)
  })

  it('done on a cancelled task switches only that task to done', async () => {
    const ctx = await makeCtx()
    const { A, A1 } = tree(ctx)
    setStatus(ctx, A, 'cancelled', { withOpenDescendants: true })
    ctx.clock.set('2026-11-10T10:00:00Z')
    const r = setStatus(ctx, A, 'done')
    expect(r.changedIds).toEqual([A])
    expect(r.task.status).toBe('done')
    expect(r.task.closedAt).toBe('2026-11-10T10:00:00.000Z')
    expect(getTask(ctx, A1).status).toBe('cancelled')
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'done')
    expect(ev[0]!.data.closedIds).toEqual([A])
  })

  it("closing clears today's day mark for every closed id", async () => {
    const ctx = await makeCtx()
    const { P, A, B } = tree(ctx)
    setMark(ctx, P, 'doing')
    setMark(ctx, A, 'worked')
    setMark(ctx, B, 'worked')
    ctx.db.run("INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-09', ?, 'worked')", P)
    setStatus(ctx, P, 'done', { withOpenDescendants: true })
    expect(ctx.db.all('SELECT * FROM day_marks WHERE date = ?', today(ctx))).toEqual([])
    expect(ctx.db.all('SELECT * FROM day_marks')).toHaveLength(1)
  })

  it('finishing the last open child does not close the parent', async () => {
    const ctx = await makeCtx()
    const { P, A, A1, A2, B, C } = tree(ctx)
    for (const id of [A1, A2, A, B, C]) setStatus(ctx, id, 'done')
    expect(getTask(ctx, P).status).toBe('open')
  })
})
