import { describe, expect, it } from 'vitest'
import {
  createTask,
  DaybreakError,
  eventsOn,
  getTask,
  liveChildren,
  pathOf,
  updateTask,
} from '../src/index'
import { makeCtx } from './helpers'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof DaybreakError ? e.code : 'other'
  }
  return undefined
}

describe('createTask', () => {
  it('creates at end of siblings', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const b = createTask(ctx, { title: 'b', section: 'inbox' })
    const c = createTask(ctx, { title: 'c', section: 'inbox' })
    expect(liveChildren(ctx, null, 'inbox').map((t) => t.id)).toEqual([a.id, b.id, c.id])
  })

  it('afterId inserts right after', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const b = createTask(ctx, { title: 'b', section: 'inbox' })
    const x = createTask(ctx, { title: 'x', section: 'inbox', afterId: a.id })
    expect(liveChildren(ctx, null, 'inbox').map((t) => t.id)).toEqual([a.id, x.id, b.id])
  })

  it('beforeId inserts right before', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox' })
    const b = createTask(ctx, { title: 'b', section: 'inbox' })
    const x = createTask(ctx, { title: 'x', section: 'inbox', beforeId: b.id })
    const y = createTask(ctx, { title: 'y', section: 'inbox', beforeId: a.id })
    expect(liveChildren(ctx, null, 'inbox').map((t) => t.id)).toEqual([y.id, a.id, x.id, b.id])
  })

  it('title is normalized', async () => {
    const ctx = await makeCtx()
    expect(createTask(ctx, { title: '  a\n\nb\tc  ', section: 'inbox' }).title).toBe('a b c')
  })

  it('empty title after normalize is invalid', async () => {
    const ctx = await makeCtx()
    expect(codeOf(() => createTask(ctx, { title: ' \n\t ', section: 'inbox' }))).toBe('invalid')
    const t = createTask(ctx, { title: 'ok', section: 'inbox' })
    expect(codeOf(() => updateTask(ctx, t.id, { title: '  ' }))).toBe('invalid')
  })

  it('inbox is flat', async () => {
    const ctx = await makeCtx()
    const p = createTask(ctx, { title: 'p', section: 'projects' })
    expect(codeOf(() => createTask(ctx, { title: 'x', section: 'inbox', parentId: p.id }))).toBe(
      'invalid',
    )
  })

  it('parentId must be a live task in projects', async () => {
    const ctx = await makeCtx()
    const p = createTask(ctx, { title: 'p', section: 'projects' })
    expect(
      codeOf(() => createTask(ctx, { title: 'x', section: 'projects', parentId: 'nope' })),
    ).toBe('not_found')
    ctx.db.run("UPDATE tasks SET deleted_at = '2026-11-10T00:00:00Z' WHERE id = ?", p.id)
    expect(codeOf(() => createTask(ctx, { title: 'x', section: 'projects', parentId: p.id }))).toBe(
      'not_found',
    )
    expect(codeOf(() => getTask(ctx, p.id))).toBe('not_found')
  })

  it('scheduledOn sets day_position at end of that day', async () => {
    const ctx = await makeCtx()
    const a = createTask(ctx, { title: 'a', section: 'inbox', scheduledOn: '2026-11-10' })
    const b = createTask(ctx, { title: 'b', section: 'projects', scheduledOn: '2026-11-10' })
    const c = createTask(ctx, { title: 'c', section: 'inbox', scheduledOn: '2026-11-10' })
    const other = createTask(ctx, { title: 'o', section: 'inbox', scheduledOn: '2026-11-11' })
    const none = createTask(ctx, { title: 'n', section: 'inbox' })
    expect(a.dayPosition! < b.dayPosition!).toBe(true)
    expect(b.dayPosition! < c.dayPosition!).toBe(true)
    expect(other.dayPosition).not.toBeNull()
    expect(none.dayPosition).toBeNull()
    expect(c.scheduledOn).toBe('2026-11-10')
  })

  it('records created event and timestamps', async () => {
    const ctx = await makeCtx('2026-11-10T08:00:00Z')
    const p = createTask(ctx, { title: 'p', section: 'projects' })
    const c = createTask(ctx, { title: 'c', section: 'projects', parentId: p.id })
    expect(c.createdAt).toBe('2026-11-10T08:00:00.000Z')
    const ev = eventsOn(ctx, '2026-11-10').filter((e) => e.taskId === c.id)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({
      kind: 'created',
      data: { title: 'c', section: 'projects', parentId: p.id },
    })
  })
})

describe('updateTask', () => {
  it('renamed event only on title change', async () => {
    const ctx = await makeCtx()
    const t = createTask(ctx, { title: 'old', section: 'inbox' })
    ctx.clock.set('2026-11-10T09:00:00Z')
    const same = updateTask(ctx, t.id, { title: ' old ', notes: 'n' })
    expect(same.updatedAt).toBe('2026-11-10T09:00:00.000Z')
    const renamedEvents = () => eventsOn(ctx, '2026-11-10').filter((e) => e.kind === 'renamed')
    expect(renamedEvents()).toHaveLength(0)
    updateTask(ctx, t.id, { title: 'new' })
    expect(renamedEvents().map((e) => e.data)).toEqual([{ from: 'old', to: 'new' }])
  })

  it('link and notes stored verbatim; collapsed and tags round-trip', async () => {
    const ctx = await makeCtx()
    const t = createTask(ctx, { title: 't', section: 'inbox' })
    const notes = '<img src=x onerror=alert(1)>'
    const u = updateTask(ctx, t.id, {
      notes,
      link: 'C:\\Docs\\a b.txt',
      collapsed: true,
      tags: ['x', 'y'],
    })
    expect(u).toMatchObject({ notes, link: 'C:\\Docs\\a b.txt', collapsed: true, tags: ['x', 'y'] })
    expect(updateTask(ctx, t.id, { link: null, collapsed: false }).link).toBeNull()
    expect(getTask(ctx, t.id).notes).toBe(notes)
  })
})

describe('pathOf', () => {
  it('Inbox task gives [Inbox]', async () => {
    const ctx = await makeCtx()
    const t = createTask(ctx, { title: 'x', section: 'inbox' })
    expect(pathOf(ctx, t.id)).toEqual(['Inbox'])
  })

  it('projects task gives ancestor titles, root first', async () => {
    const ctx = await makeCtx()
    const p = createTask(ctx, { title: 'Fridge 3 readout upgrade', section: 'projects' })
    const m = createTask(ctx, {
      title: 'Milestone 2 — Install and cooldown',
      section: 'projects',
      parentId: p.id,
    })
    const t = createTask(ctx, {
      title: 'Install TWPA on the mixing chamber plate',
      section: 'projects',
      parentId: m.id,
    })
    expect(pathOf(ctx, t.id)).toEqual([
      'Fridge 3 readout upgrade',
      'Milestone 2 — Install and cooldown',
    ])
    expect(pathOf(ctx, p.id)).toEqual([])
  })
})
