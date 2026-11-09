import { describe, expect, it } from 'vitest'
import {
  createTask,
  DaybreakError,
  eventsOn,
  getTask,
  indent,
  moveDown,
  moveTask,
  moveUp,
  outdent,
} from '../src/index'
import { build, makeCtx, outline } from './helpers'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof DaybreakError ? e.code : 'other'
  }
  return undefined
}

const TREE = 'projects:\n  A\n    A1\n    A2\n  B\n    B1\ninbox:\n  i1\n  i2'

async function setup(text = TREE) {
  const ctx = await makeCtx()
  // biome-ignore lint/suspicious/noExplicitAny: test ids are looked up by name and always exist.
  return { ctx, ids: build(ctx, text) as Record<string, any> }
}

describe('moveTask', () => {
  it('carries the subtree', async () => {
    const { ctx, ids } = await setup()
    moveTask(ctx, ids.A, { parentId: null, section: 'projects', afterId: ids.B })
    expect(outline(ctx)).toBe('projects:\n  B\n    B1\n  A\n    A1\n    A2\ninbox:\n  i1\n  i2')
  })

  it('rejects own descendant and itself', async () => {
    const { ctx, ids } = await setup()
    const before = outline(ctx)
    expect(codeOf(() => moveTask(ctx, ids.A, { parentId: ids.A1, section: 'projects' }))).toBe(
      'invalid',
    )
    expect(codeOf(() => moveTask(ctx, ids.A, { parentId: ids.A, section: 'projects' }))).toBe(
      'invalid',
    )
    expect(outline(ctx)).toBe(before)
  })

  it('into inbox requires no children and parentId null', async () => {
    const { ctx, ids } = await setup()
    expect(codeOf(() => moveTask(ctx, ids.A, { parentId: null, section: 'inbox' }))).toBe('invalid')
    expect(codeOf(() => moveTask(ctx, ids.B1, { parentId: ids.i1, section: 'inbox' }))).toBe(
      'invalid',
    )
    expect(codeOf(() => moveTask(ctx, ids.B1, { parentId: ids.A, section: 'inbox' }))).toBe(
      'invalid',
    )
    moveTask(ctx, ids.B1, { parentId: null, section: 'inbox', beforeId: ids.i1 })
    expect(outline(ctx)).toBe('projects:\n  A\n    A1\n    A2\n  B\ninbox:\n  B1\n  i1\n  i2')
  })

  it('from inbox to projects updates section', async () => {
    const { ctx, ids } = await setup()
    const t = moveTask(ctx, ids.i1, { parentId: ids.B, section: 'projects' })
    expect(t.section).toBe('projects')
    expect(t.parentId).toBe(ids.B)
    expect(outline(ctx)).toBe('projects:\n  A\n    A1\n    A2\n  B\n    B1\n    i1\ninbox:\n  i2')
  })

  it('updates descendants section when the section changes', async () => {
    const { ctx, ids } = await setup()
    // inbox is flat, so force a child under an inbox row to check the cascade
    ctx.db.run("UPDATE tasks SET parent_id = ?, section = 'inbox' WHERE id = ?", ids.i1, ids.i2)
    moveTask(ctx, ids.i1, { parentId: null, section: 'projects' })
    expect(getTask(ctx, ids.i2).section).toBe('projects')
  })

  it('missing or deleted parent is not_found, inbox parent is invalid', async () => {
    const { ctx, ids } = await setup()
    expect(codeOf(() => moveTask(ctx, ids.A1, { parentId: 'zzzzzz', section: 'projects' }))).toBe(
      'not_found',
    )
    ctx.db.run("UPDATE tasks SET deleted_at = '2026-11-10T00:00:00Z' WHERE id = ?", ids.B1)
    expect(codeOf(() => moveTask(ctx, ids.A1, { parentId: ids.B1, section: 'projects' }))).toBe(
      'not_found',
    )
    expect(codeOf(() => moveTask(ctx, ids.A1, { parentId: ids.i1, section: 'projects' }))).toBe(
      'invalid',
    )
  })

  it('records a moved event with from and to, none for a no-op', async () => {
    const { ctx, ids } = await setup()
    const a = getTask(ctx, ids.A)
    const t = moveTask(ctx, ids.A, { parentId: null, section: 'projects', afterId: ids.B })
    const ev = eventsOn(ctx, '2026-11-10').filter((e) => e.kind === 'moved')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.taskId).toBe(ids.A)
    expect(ev[0]!.data).toEqual({
      from: { parentId: null, section: 'projects', position: a.position },
      to: { parentId: null, section: 'projects', position: t.position },
    })
    moveTask(ctx, ids.A, { parentId: null, section: 'projects', afterId: ids.B })
    expect(eventsOn(ctx, '2026-11-10').filter((e) => e.kind === 'moved')).toHaveLength(1)
  })
})

describe('indent / outdent', () => {
  it('indent makes it the last child of the previous sibling and expands it', async () => {
    const { ctx, ids } = await setup()
    ctx.db.run('UPDATE tasks SET collapsed = 1 WHERE id = ?', ids.A)
    ctx.db.run('UPDATE tasks SET collapsed = 1 WHERE id = ?', ids.B)
    const t = indent(ctx, ids.B)
    expect(t.parentId).toBe(ids.A)
    expect(t.collapsed).toBe(true) // own collapsed unchanged
    expect(getTask(ctx, ids.A).collapsed).toBe(false)
    expect(outline(ctx)).toBe('projects:\n  A\n    A1\n    A2\n    B\n      B1\ninbox:\n  i1\n  i2')
    expect(eventsOn(ctx, '2026-11-10').filter((e) => e.kind === 'moved')).toHaveLength(1)
  })

  it('indent with no previous sibling is a no-op; indent in inbox is a no-op', async () => {
    const { ctx, ids } = await setup()
    const before = outline(ctx)
    indent(ctx, ids.A)
    indent(ctx, ids.A1)
    indent(ctx, ids.i1)
    indent(ctx, ids.i2)
    expect(outline(ctx)).toBe(before)
    expect(eventsOn(ctx, '2026-11-10').filter((e) => e.kind === 'moved')).toHaveLength(0)
  })

  it('outdent places it right after its parent; top-level is a no-op', async () => {
    const { ctx, ids } = await setup()
    outdent(ctx, ids.A2)
    expect(outline(ctx)).toBe('projects:\n  A\n    A1\n  A2\n  B\n    B1\ninbox:\n  i1\n  i2')
    const before = outline(ctx)
    outdent(ctx, ids.A)
    outdent(ctx, ids.i1)
    expect(outline(ctx)).toBe(before)
  })
})

describe('moveUp / moveDown', () => {
  it('moveUp swaps with previous sibling', async () => {
    const { ctx, ids } = await setup()
    moveUp(ctx, ids.A2)
    expect(outline(ctx)).toBe('projects:\n  A\n    A2\n    A1\n  B\n    B1\ninbox:\n  i1\n  i2')
  })

  it("moveUp from first child becomes last child of parent's previous sibling", async () => {
    const { ctx, ids } = await setup()
    ctx.db.run('UPDATE tasks SET collapsed = 1 WHERE id = ?', ids.A)
    moveUp(ctx, ids.B1)
    expect(outline(ctx)).toBe('projects:\n  A\n    A1\n    A2\n    B1\n  B\ninbox:\n  i1\n  i2')
    expect(getTask(ctx, ids.A).collapsed).toBe(false)
  })

  it('moveUp with no such branch is a no-op', async () => {
    const { ctx, ids } = await setup()
    const before = outline(ctx)
    moveUp(ctx, ids.A1)
    expect(outline(ctx)).toBe(before)
  })

  it('moveDown mirrors', async () => {
    const { ctx, ids } = await setup()
    ctx.db.run('UPDATE tasks SET collapsed = 1 WHERE id = ?', ids.B)
    moveDown(ctx, ids.A2)
    expect(outline(ctx)).toBe('projects:\n  A\n    A1\n  B\n    A2\n    B1\ninbox:\n  i1\n  i2')
    expect(getTask(ctx, ids.B).collapsed).toBe(false)
    const before = outline(ctx)
    moveDown(ctx, ids.B1) // last child of last project: no branch
    expect(outline(ctx)).toBe(before)
  })

  it('first top-level project moves up to the end of Inbox only if childless', async () => {
    const { ctx, ids } = await setup()
    const before = outline(ctx)
    moveUp(ctx, ids.A)
    expect(outline(ctx)).toBe(before)
    const c = createTask(ctx, { title: 'C', section: 'projects', beforeId: ids.A })
    moveUp(ctx, c.id)
    expect(outline(ctx)).toBe(
      'projects:\n  A\n    A1\n    A2\n  B\n    B1\ninbox:\n  i1\n  i2\n  C',
    )
    expect(getTask(ctx, c.id).section).toBe('inbox')
  })

  it('last Inbox task moves down to the first top-level project', async () => {
    const { ctx, ids } = await setup()
    moveDown(ctx, ids.i2)
    expect(outline(ctx)).toBe('projects:\n  i2\n  A\n    A1\n    A2\n  B\n    B1\ninbox:\n  i1')
    expect(getTask(ctx, ids.i2).section).toBe('projects')
  })

  it('last top-level project moveDown is a no-op', async () => {
    const { ctx, ids } = await setup()
    const before = outline(ctx)
    moveDown(ctx, ids.B)
    expect(outline(ctx)).toBe(before)
  })

  it('five rapid moveDown calls move exactly five slots', async () => {
    const { ctx, ids } = await setup('inbox:\n  a\n  b\n  c\n  d\n  e\n  f\n  g\n  h')
    for (let i = 0; i < 5; i++) moveDown(ctx, ids.a)
    expect(outline(ctx)).toBe('projects:\ninbox:\n  b\n  c\n  d\n  e\n  f\n  a\n  g\n  h')
  })

  it('moveDown skips a sibling closed 2 days ago (hidden under the recent rule)', async () => {
    const { ctx, ids } = await setup('projects:\n  A\n  X\n  B\n  C')
    ctx.db.run(
      "UPDATE tasks SET status = 'done', closed_at = '2026-11-08T07:00:00Z' WHERE id = ?",
      ids.X,
    )
    moveDown(ctx, ids.A)
    expect(outline(ctx)).toBe('projects:\n  X\n  B\n  A\n  C\ninbox:')
  })
})
