import { describe, expect, it } from 'vitest'
import {
  DaybreakError, createTask, dayView, eventsOn, getTask, liveChildren, restore, schedule, setMark,
  softDelete, today, treeView,
} from '../src/index'
import type { Ctx } from '../src/index'
import { build, makeCtx, outline } from './helpers'

const TREE = `projects:
  P
    A
      A1
      A2
    B
    C
inbox:
  X
`

type Ids = Record<'P' | 'A' | 'A1' | 'A2' | 'B' | 'C' | 'X', string>
const tree = (ctx: Ctx) => build(ctx, TREE) as Ids
const deletedAt = (ctx: Ctx, id: string) =>
  ctx.db.get<{ deleted_at: string | null }>('SELECT deleted_at FROM tasks WHERE id = ?', id)!.deleted_at

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof DaybreakError ? e.code : 'other'
  }
  return undefined
}

describe('softDelete', () => {
  it('deletes the subtree with one timestamp', async () => {
    const ctx = await makeCtx()
    const { A, A1, A2, B } = tree(ctx)
    const r = softDelete(ctx, A)
    expect(r.deletedIds).toEqual([A, A1, A2])
    for (const id of r.deletedIds) expect(deletedAt(ctx, id)).toBe('2026-11-10T08:00:00.000Z')
    expect(deletedAt(ctx, B)).toBeNull()
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'deleted')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.taskId).toBe(A)
    expect(ev[0]!.data.ids).toEqual([A, A1, A2])
  })

  it('deleted tasks vanish from treeView, dayView, getTask and children', async () => {
    const ctx = await makeCtx()
    const { P, A, A1 } = tree(ctx)
    schedule(ctx, A1, today(ctx))
    softDelete(ctx, A)
    expect(code(() => getTask(ctx, A))).toBe('not_found')
    expect(code(() => getTask(ctx, A1))).toBe('not_found')
    expect(liveChildren(ctx, P, 'projects').map((t) => t.title)).toEqual(['B', 'C'])
    expect(dayView(ctx, today(ctx)).items).toEqual([])
    const p = treeView(ctx, 'all').projects[0]!
    expect(p.children.map((c) => c.title)).toEqual(['B', 'C'])
  })

  it('deleting a missing or already deleted task throws not_found', async () => {
    const ctx = await makeCtx()
    const { A } = tree(ctx)
    expect(code(() => softDelete(ctx, 'nope00'))).toBe('not_found')
    softDelete(ctx, A)
    expect(code(() => softDelete(ctx, A))).toBe('not_found')
  })
})

describe('restore', () => {
  it('brings back exactly that set at the same positions, even with siblings added since', async () => {
    const ctx = await makeCtx()
    const { P, A } = tree(ctx)
    const before = outline(ctx)
    softDelete(ctx, A)
    createTask(ctx, { title: 'New', section: 'projects', parentId: P })
    const r = restore(ctx, A)
    expect(r.restoredIds).toHaveLength(3)
    expect(outline(ctx)).toBe(before.replace('    C\n', '    C\n    New\n'))
    const ev = eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'restored')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.data.ids).toEqual(r.restoredIds)
  })

  it('restores to the identical outline when nothing else changed', async () => {
    const ctx = await makeCtx()
    const { A, B } = tree(ctx)
    const before = outline(ctx)
    softDelete(ctx, A)
    softDelete(ctx, B)
    restore(ctx, B)
    restore(ctx, A)
    expect(outline(ctx)).toBe(before)
  })

  it('does not resurrect a child deleted separately earlier', async () => {
    const ctx = await makeCtx()
    const { A, A1, A2 } = tree(ctx)
    softDelete(ctx, A1)
    ctx.clock.set('2026-11-10T09:00:00Z')
    softDelete(ctx, A)
    const r = restore(ctx, A)
    expect(r.restoredIds).toEqual([A, A2])
    expect(code(() => getTask(ctx, A1))).toBe('not_found')
    expect(getTask(ctx, A2).deletedAt).toBeNull()
  })

  it('throws invalid for a task that was never deleted', async () => {
    const ctx = await makeCtx()
    const { B } = tree(ctx)
    expect(code(() => restore(ctx, B))).toBe('invalid')
    expect(code(() => restore(ctx, 'nope00'))).toBe('invalid')
  })

  it('throws invalid when already restored', async () => {
    const ctx = await makeCtx()
    const { B } = tree(ctx)
    softDelete(ctx, B)
    restore(ctx, B)
    expect(code(() => restore(ctx, B))).toBe('invalid')
  })

  it('throws invalid when the parent is still deleted, leaving the task deleted', async () => {
    const ctx = await makeCtx()
    const { A, A1 } = tree(ctx)
    softDelete(ctx, A1)
    ctx.clock.set('2026-11-10T09:00:00Z')
    softDelete(ctx, A)
    expect(code(() => restore(ctx, A1))).toBe('invalid')
    expect(deletedAt(ctx, A1)).not.toBeNull()
  })

  it('a deleted Doing task leaves dayView and returns with its mark', async () => {
    const ctx = await makeCtx()
    const { B } = tree(ctx)
    setMark(ctx, B, 'doing')
    softDelete(ctx, B)
    expect(dayView(ctx, today(ctx)).items).toEqual([])
    restore(ctx, B)
    const items = dayView(ctx, today(ctx)).items
    expect(items.map((i) => [i.task.id, i.mark])).toEqual([[B, 'doing']])
  })
})
