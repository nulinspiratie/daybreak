import type { Ctx } from '../ctx'
import type { ISODate } from '../dates'
import type { Mark } from '../types'

/** Marks set on `date`, keyed by task id. Live tasks only. */
export function marksOn(ctx: Ctx, date: ISODate): Map<string, Mark> {
  const rows = ctx.db.all<{ task_id: string; mark: string }>(
    `SELECT m.task_id, m.mark FROM day_marks m
     JOIN tasks t ON t.id = m.task_id
     WHERE m.date = ? AND t.deleted_at IS NULL`,
    date,
  )
  return new Map(rows.map((r) => [r.task_id, r.mark as Mark]))
}
