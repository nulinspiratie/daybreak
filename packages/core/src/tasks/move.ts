import type { Ctx } from '../ctx'
import { nowIso } from '../ctx'
import { transaction } from '../db/adapter'
import { DaybreakError } from '../errors'
import { recordEvent } from '../events'
import type { MoveTarget, Task } from '../types'
import { positionFor } from './positions'
import { getTask, liveChildren, liveDescendants } from './rows'
import { isRecentlyHidden } from './tree'

/**
 * Move a task (with its subtree) to `to`. The one place that checks cycles and
 * the flat Inbox. Moving to where it already is changes nothing and records nothing.
 */
export function moveTask(ctx: Ctx, id: string, to: MoveTarget): Task {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    const descendants = liveDescendants(ctx, id)

    if (to.section === 'inbox') {
      if (to.parentId !== null) throw new DaybreakError('invalid', 'Inbox tasks cannot have a parent')
      if (descendants.length > 0) throw new DaybreakError('invalid', 'A task with subtasks cannot go into Inbox')
    } else if (to.parentId !== null) {
      const parent = getTask(ctx, to.parentId)
      if (parent.section !== 'projects') throw new DaybreakError('invalid', `#${parent.id} is not a project task`)
      if (parent.id === id || descendants.some((d) => d.id === parent.id)) {
        throw new DaybreakError('invalid', 'A task cannot move under itself or its own descendant')
      }
    }

    const all = liveChildren(ctx, to.parentId, to.section)
    const siblings = all.filter((s) => s.id !== id)
    const position = positionFor(siblings, { afterId: to.afterId, beforeId: to.beforeId })

    // Where it lands among the other siblings, to detect a no-op.
    const index =
      to.afterId !== undefined
        ? siblings.findIndex((s) => s.id === to.afterId) + 1
        : to.beforeId !== undefined
          ? siblings.findIndex((s) => s.id === to.beforeId)
          : siblings.length
    if (
      task.parentId === to.parentId &&
      task.section === to.section &&
      all.findIndex((s) => s.id === id) === index
    ) {
      return task
    }

    const now = nowIso(ctx)
    ctx.db.run(
      'UPDATE tasks SET parent_id = ?, section = ?, position = ?, updated_at = ? WHERE id = ?',
      to.parentId,
      to.section,
      position,
      now,
      id,
    )
    if (task.section !== to.section) {
      for (const d of descendants) {
        ctx.db.run('UPDATE tasks SET section = ?, updated_at = ? WHERE id = ?', to.section, now, d.id)
      }
    }
    recordEvent(ctx, 'moved', id, {
      from: { parentId: task.parentId, section: task.section, position: task.position },
      to: { parentId: to.parentId, section: to.section, position },
    })
    return getTask(ctx, id)
  })
}

/** Siblings as the tree shows them under the 'recent' rule; `keepId` is always kept. */
function visibleSiblings(ctx: Ctx, parentId: string | null, section: Task['section'], keepId?: string): Task[] {
  const nowMs = new Date(nowIso(ctx)).getTime()
  return liveChildren(ctx, parentId, section).filter((s) => {
    if (s.id === keepId || s.status === 'open') return true
    const openBelow = liveDescendants(ctx, s.id).some((d) => d.status === 'open')
    return !isRecentlyHidden(s, openBelow, nowMs)
  })
}

function expand(ctx: Ctx, id: string): void {
  ctx.db.run('UPDATE tasks SET collapsed = 0, updated_at = ? WHERE id = ? AND collapsed <> 0', nowIso(ctx), id)
}

/** Move into `parent` (last child, or first when `first`) and expand it. */
function moveInto(ctx: Ctx, task: Task, parent: Task, first = false): Task {
  const target: MoveTarget = { parentId: parent.id, section: parent.section }
  if (first) {
    const head = liveChildren(ctx, parent.id, parent.section)[0]
    if (head) target.beforeId = head.id
  }
  const moved = moveTask(ctx, task.id, target)
  expand(ctx, parent.id)
  return moved
}

export function indent(ctx: Ctx, id: string): Task {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    if (task.section === 'inbox') return task
    const sibs = visibleSiblings(ctx, task.parentId, task.section, id)
    const i = sibs.findIndex((s) => s.id === id)
    if (i <= 0) return task
    return moveInto(ctx, task, sibs[i - 1]!)
  })
}

export function outdent(ctx: Ctx, id: string): Task {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    if (task.parentId === null) return task
    const parent = getTask(ctx, task.parentId)
    return moveTask(ctx, id, { parentId: parent.parentId, section: parent.section, afterId: parent.id })
  })
}

export function moveUp(ctx: Ctx, id: string): Task {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    const sibs = visibleSiblings(ctx, task.parentId, task.section, id)
    const i = sibs.findIndex((s) => s.id === id)
    if (i > 0) {
      return moveTask(ctx, id, { parentId: task.parentId, section: task.section, beforeId: sibs[i - 1]!.id })
    }
    if (task.parentId !== null) {
      const parent = getTask(ctx, task.parentId)
      const ps = visibleSiblings(ctx, parent.parentId, parent.section, parent.id)
      const pi = ps.findIndex((s) => s.id === parent.id)
      return pi > 0 ? moveInto(ctx, task, ps[pi - 1]!) : task
    }
    if (task.section === 'projects' && liveChildren(ctx, task.id, 'projects').length === 0) {
      return moveTask(ctx, id, { parentId: null, section: 'inbox' })
    }
    return task
  })
}

export function moveDown(ctx: Ctx, id: string): Task {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    const sibs = visibleSiblings(ctx, task.parentId, task.section, id)
    const i = sibs.findIndex((s) => s.id === id)
    if (i < sibs.length - 1) {
      return moveTask(ctx, id, { parentId: task.parentId, section: task.section, afterId: sibs[i + 1]!.id })
    }
    if (task.parentId !== null) {
      const parent = getTask(ctx, task.parentId)
      const ps = visibleSiblings(ctx, parent.parentId, parent.section, parent.id)
      const pi = ps.findIndex((s) => s.id === parent.id)
      return pi < ps.length - 1 ? moveInto(ctx, task, ps[pi + 1]!, true) : task
    }
    if (task.section === 'inbox') {
      const first = liveChildren(ctx, null, 'projects')[0]
      return moveTask(ctx, id, { parentId: null, section: 'projects', beforeId: first?.id })
    }
    return task
  })
}
