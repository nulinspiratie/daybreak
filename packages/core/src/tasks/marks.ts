import type { Ctx } from '../ctx'
import { today } from '../ctx'
import type { ISODate } from '../dates'
import { transaction } from '../db/adapter'
import { DaybreakError } from '../errors'
import { recordEvent } from '../events'
import type { Mark } from '../types'
import { getTask } from './rows'
import { scheduleToday } from './schedule'

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

/** At most one task is 'doing' per day; setting another demotes it to 'worked'. */
const SINGLE_DOING = true

/**
 * Set, toggle or clear today's mark for a task. Marking the task's current mark
 * again clears it; null clears. Clearing records no event. Setting a mark on a
 * task not scheduled today schedules it today.
 */
export function setMark(ctx: Ctx, id: string, mark: Mark | null): void {
  transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    if (task.status !== 'open') {
      throw new DaybreakError('invalid', `Task #${id} is ${task.status}; reopen it first`, { id })
    }
    const date = today(ctx)
    const current = marksOn(ctx, date).get(id) ?? null
    if (mark === null || mark === current) {
      ctx.db.run('DELETE FROM day_marks WHERE date = ? AND task_id = ?', date, id)
      return
    }
    if (SINGLE_DOING && mark === 'doing') {
      for (const [otherId, m] of marksOn(ctx, date)) {
        if (otherId === id || m !== 'doing') continue
        ctx.db.run(
          "UPDATE day_marks SET mark = 'worked' WHERE date = ? AND task_id = ?",
          date,
          otherId,
        )
        recordEvent(ctx, 'worked', otherId, { date })
      }
    }
    if (task.scheduledOn !== date) scheduleToday(ctx, id)
    ctx.db.run(
      `INSERT INTO day_marks (date, task_id, mark) VALUES (?, ?, ?)
       ON CONFLICT (date, task_id) DO UPDATE SET mark = excluded.mark`,
      date,
      id,
      mark,
    )
    recordEvent(ctx, mark, id, { date })
  })
}

/** The latest date before `date` on which the task was marked 'worked' or 'doing', else null. */
export function lastWorkedBefore(ctx: Ctx, id: string, date: ISODate): ISODate | null {
  const row = ctx.db.get<{ date: string | null }>(
    `SELECT MAX(date) AS date FROM day_marks
     WHERE task_id = ? AND date < ? AND mark IN ('worked', 'doing')`,
    id,
    date,
  )
  return row?.date ?? null
}
