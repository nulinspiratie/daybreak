import type { Ctx } from '../ctx'
import { nowIso, today } from '../ctx'
import { transaction } from '../db/adapter'
import { DaybreakError } from '../errors'
import { recordEvent } from '../events'
import type { Status, Task } from '../types'
import { getTask, liveDescendants } from './rows'

/** Close the ids (status + closed_at) and drop today's day marks for them. */
function closeIds(ctx: Ctx, ids: string[], status: Status): void {
  const now = nowIso(ctx)
  const date = today(ctx)
  for (const id of ids) {
    ctx.db.run('UPDATE tasks SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?', status, now, now, id)
    ctx.db.run('DELETE FROM day_marks WHERE date = ? AND task_id = ?', date, id)
  }
}

/**
 * Change a task's status. Closing a task with open descendants needs
 * `withOpenDescendants` (else needs_confirmation with details.openCount) and
 * closes them with it. Reopening restores the ids closed together with it.
 */
export function setStatus(
  ctx: Ctx,
  id: string,
  status: Status,
  opts: { withOpenDescendants?: boolean } = {},
): { task: Task; changedIds: string[] } {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    if (task.status === status) return { task, changedIds: [] }

    if (status === 'open') {
      const last = ctx.db.get<{ data: string | null }>(
        `SELECT data FROM events WHERE task_id = ? AND kind IN ('done', 'cancelled')
         ORDER BY id DESC LIMIT 1`,
        id,
      )
      const closedIds: string[] = last?.data ? (JSON.parse(last.data).closedIds ?? []) : []
      const ids = [id]
      for (const cid of closedIds) {
        if (cid === id) continue
        const row = ctx.db.get<{ status: string }>(
          'SELECT status FROM tasks WHERE id = ? AND deleted_at IS NULL',
          cid,
        )
        if (row && row.status !== 'open') ids.push(cid)
      }
      const now = nowIso(ctx)
      for (const rid of ids) {
        ctx.db.run(
          "UPDATE tasks SET status = 'open', closed_at = NULL, updated_at = ? WHERE id = ?",
          now,
          rid,
        )
      }
      recordEvent(ctx, 'reopened', id, { ids })
      return { task: getTask(ctx, id), changedIds: ids }
    }

    let closedIds = [id]
    if (task.status === 'open') {
      const open = liveDescendants(ctx, id).filter((d) => d.status === 'open')
      if (open.length > 0) {
        if (!opts.withOpenDescendants) {
          throw new DaybreakError('needs_confirmation', `Task #${id} has ${open.length} open subtasks`, {
            openCount: open.length,
          })
        }
        closedIds = [id, ...open.map((d) => d.id)]
      }
    }
    closeIds(ctx, closedIds, status)
    recordEvent(ctx, status === 'done' ? 'done' : 'cancelled', id, { closedIds })
    return { task: getTask(ctx, id), changedIds: closedIds }
  })
}
