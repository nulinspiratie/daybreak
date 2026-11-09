import type { Ctx } from '../ctx'
import { nowIso, today } from '../ctx'
import type { Task, TreeNode, TreeView } from '../types'
import { marksOn } from './marks'
import { rowToTask, TASK_COLUMNS, type TaskRow } from './rows'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The 'recent' rule: a closed task is hidden once it was closed more than 24 h
 * before `nowMs`, unless something open is still below it.
 */
export function isRecentlyHidden(task: Task, hasOpenDescendant: boolean, nowMs: number): boolean {
  if (task.status === 'open' || hasOpenDescendant || task.closedAt === null) return false
  return new Date(task.closedAt).getTime() < nowMs - DAY_MS
}

/** Per task: counts over all live descendants, and whether any is open. */
export interface SubtreeStat {
  done: number
  total: number
  size: number
  openBelow: boolean
}

/** Every live task grouped by parent id (null = top level), ordered by position, id. */
export function liveKids(ctx: Ctx): Map<string | null, Task[]> {
  const tasks = ctx.db
    .all<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE deleted_at IS NULL ORDER BY position, id`,
    )
    .map(rowToTask)
  const kids = new Map<string | null, Task[]>()
  for (const t of tasks) {
    const list = kids.get(t.parentId)
    if (list) list.push(t)
    else kids.set(t.parentId, [t])
  }
  return kids
}

/** Descendant stats for every live task. Cancelled tasks are excluded from `total`. */
export function subtreeStats(kids: Map<string | null, Task[]>): Map<string, SubtreeStat> {
  const stats = new Map<string, SubtreeStat>()
  const measure = (t: Task): SubtreeStat => {
    let done = 0
    let total = 0
    let size = 0
    let openBelow = false
    for (const c of kids.get(t.id) ?? []) {
      const s = measure(c)
      size += 1 + s.size
      done += s.done
      total += s.total
      openBelow ||= s.openBelow
      if (c.status === 'open') openBelow = true
      if (c.status !== 'cancelled') total += 1
      if (c.status === 'done') done += 1
    }
    const result: SubtreeStat = { done, total, size, openBelow }
    stats.set(t.id, result)
    return result
  }
  for (const t of kids.get(null) ?? []) measure(t)
  return stats
}

export function treeView(ctx: Ctx, completed: 'recent' | 'all' | 'none'): TreeView {
  const date = today(ctx)
  const marks = marksOn(ctx, date)
  const nowMs = new Date(nowIso(ctx)).getTime()

  const kids = liveKids(ctx)

  const stats = subtreeStats(kids)

  const isHidden = (t: Task): boolean => {
    if (t.status === 'open' || completed === 'all') return false
    if (stats.get(t.id)!.openBelow) return false
    if (completed === 'none') return true
    return isRecentlyHidden(t, false, nowMs)
  }

  let hiddenCompletedCount = 0
  const build = (t: Task): TreeNode | null => {
    if (isHidden(t)) {
      hiddenCompletedCount += 1 + stats.get(t.id)!.size
      return null
    }
    const s = stats.get(t.id)!
    const children: TreeNode[] = []
    for (const c of kids.get(t.id) ?? []) {
      const node = build(c)
      if (node) children.push(node)
    }
    return { ...t, children, mark: marks.get(t.id) ?? null, doneCount: s.done, totalCount: s.total }
  }

  const roots = (section: Task['section']) => {
    const out: TreeNode[] = []
    for (const t of kids.get(null) ?? []) {
      if (t.section !== section) continue
      const node = build(t)
      if (node) out.push(node)
    }
    return out
  }

  const inbox = roots('inbox')
  const projects = roots('projects')
  return { today: date, inbox, projects, hiddenCompletedCount }
}
