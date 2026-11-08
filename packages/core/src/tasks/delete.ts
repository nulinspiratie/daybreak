import type { Ctx } from '../ctx'
import { nowIso } from '../ctx'
import { transaction } from '../db/adapter'
import { DaybreakError } from '../errors'
import { recordEvent } from '../events'
import { getTask, liveDescendants } from './rows'

/**
 * Soft-delete a task and its live subtree with one timestamp. Day marks and
 * positions are left alone so restore brings everything back as it was.
 */
export function softDelete(ctx: Ctx, id: string): { deletedIds: string[] } {
  return transaction(ctx.db, () => {
    getTask(ctx, id)
    const deletedIds = [id, ...liveDescendants(ctx, id).map((d) => d.id)]
    const now = nowIso(ctx)
    for (const did of deletedIds) {
      ctx.db.run('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, did)
    }
    recordEvent(ctx, 'deleted', id, { ids: deletedIds })
    return { deletedIds }
  })
}

/**
 * Undo the latest delete of `id`: restores the ids of that delete that are
 * still deleted with the same timestamp (a child deleted separately earlier
 * stays deleted). Refuses when the parent is deleted or nothing was deleted.
 */
export function restore(ctx: Ctx, id: string): { restoredIds: string[] } {
  return transaction(ctx.db, () => {
    const row = ctx.db.get<{ parent_id: string | null; deleted_at: string | null }>(
      'SELECT parent_id, deleted_at FROM tasks WHERE id = ?',
      id,
    )
    if (!row || row.deleted_at === null) {
      throw new DaybreakError('invalid', `Task #${id} is not deleted`, { id })
    }
    const last = ctx.db.get<{ data: string | null }>(
      "SELECT data FROM events WHERE task_id = ? AND kind = 'deleted' ORDER BY id DESC LIMIT 1",
      id,
    )
    if (!last) throw new DaybreakError('invalid', `No delete of task #${id} to restore`, { id })
    if (row.parent_id !== null) {
      const parent = ctx.db.get<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM tasks WHERE id = ?',
        row.parent_id,
      )
      if (parent?.deleted_at) {
        throw new DaybreakError(
          'invalid',
          `Task #${id} is inside deleted task #${row.parent_id}; restore that first`,
          { id, parentId: row.parent_id },
        )
      }
    }
    const ids: string[] = last.data ? (JSON.parse(last.data).ids ?? []) : []
    const now = nowIso(ctx)
    const restoredIds: string[] = []
    for (const rid of ids) {
      const res = ctx.db.run(
        'UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?',
        now,
        rid,
        row.deleted_at,
      )
      if (res.changes > 0) restoredIds.push(rid)
    }
    recordEvent(ctx, 'restored', id, { ids: restoredIds })
    return { restoredIds }
  })
}
