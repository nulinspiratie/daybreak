import type { Ctx } from '../ctx'
import { DaybreakError } from '../errors'
import type { Section, Task } from '../types'

export interface TaskRow {
  id: string
  parent_id: string | null
  section: string
  position: string
  title: string
  notes: string
  link: string | null
  scheduled_on: string | null
  day_position: string | null
  status: string
  closed_at: string | null
  deleted_at: string | null
  collapsed: number
  tags: string
  created_at: string
  updated_at: string
}

export const TASK_COLUMNS =
  'id, parent_id, section, position, title, notes, link, scheduled_on, day_position, status, closed_at, deleted_at, collapsed, tags, created_at, updated_at'

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    parentId: r.parent_id,
    section: r.section as Section,
    position: r.position,
    title: r.title,
    notes: r.notes,
    link: r.link,
    scheduledOn: r.scheduled_on,
    dayPosition: r.day_position,
    status: r.status as Task['status'],
    closedAt: r.closed_at,
    deletedAt: r.deleted_at,
    collapsed: r.collapsed !== 0,
    tags: JSON.parse(r.tags) as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** A live task by id. Throws not_found for missing and soft-deleted tasks. */
export function getTask(ctx: Ctx, id: string): Task {
  const row = ctx.db.get<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ? AND deleted_at IS NULL`,
    id,
  )
  if (!row) throw new DaybreakError('not_found', `Task #${id} not found`, { id })
  return rowToTask(row)
}

/** Live children of `parentId` (null = top level of `section`), ordered by position, id. */
export function liveChildren(ctx: Ctx, parentId: string | null, section: Section): Task[] {
  const rows =
    parentId === null
      ? ctx.db.all<TaskRow>(
          `SELECT ${TASK_COLUMNS} FROM tasks
           WHERE parent_id IS NULL AND section = ? AND deleted_at IS NULL
           ORDER BY position, id`,
          section,
        )
      : ctx.db.all<TaskRow>(
          `SELECT ${TASK_COLUMNS} FROM tasks
           WHERE parent_id = ? AND section = ? AND deleted_at IS NULL
           ORDER BY position, id`,
          parentId,
          section,
        )
  return rows.map(rowToTask)
}

/** All live descendants of `id`, depth-first in sibling order. */
export function liveDescendants(ctx: Ctx, id: string): Task[] {
  const root = getTask(ctx, id)
  const out: Task[] = []
  const walk = (parentId: string) => {
    for (const child of liveChildren(ctx, parentId, root.section)) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return out
}

/** Ancestor titles, root first, not including the task itself. Inbox tasks give ['Inbox']. */
export function pathOf(ctx: Ctx, id: string): string[] {
  const task = getTask(ctx, id)
  if (task.section === 'inbox') return ['Inbox']
  const path: string[] = []
  let parentId = task.parentId
  while (parentId !== null) {
    const parent = getTask(ctx, parentId)
    path.unshift(parent.title)
    parentId = parent.parentId
  }
  return path
}
