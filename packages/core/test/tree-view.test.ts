import { describe, expect, it } from 'vitest'
import type { Task, TreeNode } from '../src/index'
import { createTask, treeView } from '../src/index'
import { makeCtx } from './helpers'

const NOW = '2026-11-10T09:00:00Z'
const hoursAgo = (h: number) => new Date(new Date(NOW).getTime() - h * 3600_000).toISOString()

type Ctx = Awaited<ReturnType<typeof makeCtx>>

function mk(
  ctx: Ctx,
  title: string,
  parent?: Task,
  opts: { status?: 'done' | 'cancelled'; closedHoursAgo?: number } = {},
): Task {
  const t = createTask(ctx, { title, section: 'projects', parentId: parent?.id ?? null })
  if (opts.status) {
    ctx.db.run(
      'UPDATE tasks SET status = ?, closed_at = ? WHERE id = ?',
      opts.status,
      hoursAgo(opts.closedHoursAgo ?? 1),
      t.id,
    )
  }
  return t
}

const titles = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => [n.title, ...titles(n.children).map((c) => `${n.title}>${c}`)])

describe('treeView', () => {
  it('done/total counts every descendant, cancelled excluded from both', async () => {
    const ctx = await makeCtx(NOW)
    const p = mk(ctx, 'p')
    const c = mk(ctx, 'c', p)
    mk(ctx, 'gc-done', c, { status: 'done' })
    mk(ctx, 'gc-cancelled', c, { status: 'cancelled' })
    mk(ctx, 'gc-open', c)
    const tree = treeView(ctx, 'all')
    // p's descendants: c (open), gc-done, gc-open count; gc-cancelled does not
    expect(tree.projects[0]).toMatchObject({ doneCount: 1, totalCount: 3 })
    expect(tree.projects[0]!.children[0]).toMatchObject({ doneCount: 1, totalCount: 2 })
    expect(tree.projects[0]!.children[0]!.children[2]).toMatchObject({
      doneCount: 0,
      totalCount: 0,
    })
  })

  it('recent hides tasks closed more than 24 h ago', async () => {
    const ctx = await makeCtx(NOW)
    mk(ctx, 'fresh', undefined, { status: 'done', closedHoursAgo: 23 })
    const old = mk(ctx, 'old', undefined, { status: 'done', closedHoursAgo: 25 })
    mk(ctx, 'old-child', old, { status: 'done', closedHoursAgo: 30 })
    mk(ctx, 'old-cancelled', undefined, { status: 'cancelled', closedHoursAgo: 48 })
    mk(ctx, 'open')
    const tree = treeView(ctx, 'recent')
    expect(titles(tree.projects)).toEqual(['fresh', 'open'])
    expect(tree.hiddenCompletedCount).toBe(3)
  })

  it('a closed task stays visible while any descendant is open', async () => {
    const ctx = await makeCtx(NOW)
    const p = mk(ctx, 'p', undefined, { status: 'done', closedHoursAgo: 100 })
    const c = mk(ctx, 'c', p, { status: 'done', closedHoursAgo: 100 })
    mk(ctx, 'deep-open', c)
    mk(ctx, 'sibling-closed', p, { status: 'done', closedHoursAgo: 100 })
    for (const mode of ['recent', 'none'] as const) {
      const tree = treeView(ctx, mode)
      expect(titles(tree.projects)).toEqual(['p', 'p>c', 'p>c>deep-open'])
      expect(tree.hiddenCompletedCount).toBe(1)
    }
  })

  it('all shows everything closed', async () => {
    const ctx = await makeCtx(NOW)
    mk(ctx, 'old', undefined, { status: 'done', closedHoursAgo: 500 })
    mk(ctx, 'x', undefined, { status: 'cancelled', closedHoursAgo: 500 })
    const tree = treeView(ctx, 'all')
    expect(titles(tree.projects)).toEqual(['old', 'x'])
    expect(tree.hiddenCompletedCount).toBe(0)
  })

  it('none hides every closed task', async () => {
    const ctx = await makeCtx(NOW)
    mk(ctx, 'fresh', undefined, { status: 'done', closedHoursAgo: 1 })
    mk(ctx, 'open')
    const tree = treeView(ctx, 'none')
    expect(titles(tree.projects)).toEqual(['open'])
    expect(tree.hiddenCompletedCount).toBe(1)
  })

  it('deleted tasks never appear and are not counted', async () => {
    const ctx = await makeCtx(NOW)
    const p = mk(ctx, 'p')
    const gone = mk(ctx, 'gone', p, { status: 'done', closedHoursAgo: 100 })
    mk(ctx, 'gone-child', gone, { status: 'done' })
    ctx.db.run('UPDATE tasks SET deleted_at = ? WHERE id = ?', NOW, gone.id)
    ctx.db.run("UPDATE tasks SET deleted_at = ? WHERE title = 'gone-child'", NOW)
    const inboxGone = createTask(ctx, { title: 'inbox-gone', section: 'inbox' })
    ctx.db.run('UPDATE tasks SET deleted_at = ? WHERE id = ?', NOW, inboxGone.id)
    for (const mode of ['recent', 'all', 'none'] as const) {
      const tree = treeView(ctx, mode)
      expect(titles(tree.projects)).toEqual(['p'])
      expect(tree.inbox).toEqual([])
      expect(tree.hiddenCompletedCount).toBe(0)
      expect(tree.projects[0]).toMatchObject({ doneCount: 0, totalCount: 0 })
    }
  })

  it("mark is today's day mark", async () => {
    const ctx = await makeCtx(NOW)
    const a = mk(ctx, 'a')
    const b = mk(ctx, 'b')
    const c = mk(ctx, 'c')
    ctx.db.run(
      "INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-10', ?, 'doing')",
      a.id,
    )
    ctx.db.run(
      "INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-09', ?, 'worked')",
      b.id,
    )
    const tree = treeView(ctx, 'all')
    expect(tree.today).toBe('2026-11-10')
    expect(tree.projects.map((n) => n.mark)).toEqual(['doing', null, null])
    expect(c.id).toBeTruthy()
  })

  it('splits inbox and projects, in sibling order', async () => {
    const ctx = await makeCtx(NOW)
    createTask(ctx, { title: 'i1', section: 'inbox' })
    createTask(ctx, { title: 'i2', section: 'inbox' })
    mk(ctx, 'p')
    const tree = treeView(ctx, 'recent')
    expect(tree.inbox.map((n) => n.title)).toEqual(['i1', 'i2'])
    expect(tree.projects.map((n) => n.title)).toEqual(['p'])
  })
})
