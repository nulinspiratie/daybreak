import type { Ctx } from '../ctx'
import { nowIso, today } from '../ctx'
import { transaction } from '../db/adapter'
import { addDays, parseDayInput, type ISODate } from '../dates'
import { DaybreakError } from '../errors'
import { recordEvent } from '../events'
import type { DayItem, DayView, Task } from '../types'
import { marksOn } from './marks'
import { positionFor } from './positions'
import { getTask, pathOf, rowToTask, TASK_COLUMNS, type TaskRow } from './rows'
import { liveKids, subtreeStats } from './tree'

/** Live tasks scheduled on `date`, ordered by day_position, id. */
function liveOnDay(ctx: Ctx, date: ISODate): Task[] {
  return ctx.db
    .all<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE scheduled_on = ? AND deleted_at IS NULL ORDER BY day_position, id`,
      date,
    )
    .map(rowToTask)
}

/**
 * A day_position key for `date`: at the end by default, or next to afterId/beforeId.
 * `excludeId` (the task being moved) is left out of the siblings.
 */
export function dayPositionFor(
  ctx: Ctx,
  date: ISODate,
  at: { afterId?: string; beforeId?: string },
  excludeId?: string,
): string {
  const siblings = liveOnDay(ctx, date).filter((t) => t.id !== excludeId)
  const ref = at.afterId ?? at.beforeId
  if (ref !== undefined && !siblings.some((s) => s.id === ref)) {
    throw new DaybreakError('invalid', `#${ref} is not scheduled on ${date}`)
  }
  return positionFor(siblings, at, (t) => t.dayPosition)
}

function requireIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseDayInput(date, date) !== date) {
    throw new DaybreakError('invalid', `Invalid date: ${date}`)
  }
}

/**
 * Schedule a task on `date` (null clears it). Rescheduling to the same day
 * with a position only reorders and records no event.
 */
export function schedule(
  ctx: Ctx,
  id: string,
  date: ISODate | null,
  at: { afterId?: string; beforeId?: string } = {},
): Task {
  if (date !== null) requireIsoDate(date)
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    const from = task.scheduledOn
    if (date === null) {
      if (from === null) return task
      ctx.db.run(
        'UPDATE tasks SET scheduled_on = NULL, day_position = NULL, updated_at = ? WHERE id = ?',
        nowIso(ctx),
        id,
      )
      recordEvent(ctx, 'unscheduled', id, { from })
      return getTask(ctx, id)
    }
    const positioned = at.afterId !== undefined || at.beforeId !== undefined
    if (date === from && !positioned) return task
    const dayPosition = dayPositionFor(ctx, date, at, id)
    ctx.db.run(
      'UPDATE tasks SET scheduled_on = ?, day_position = ?, updated_at = ? WHERE id = ?',
      date,
      dayPosition,
      nowIso(ctx),
      id,
    )
    if (date !== from) recordEvent(ctx, 'scheduled', id, { from, to: date })
    return getTask(ctx, id)
  })
}

/** Append to today's list; no-op if already scheduled today. */
export function scheduleToday(ctx: Ctx, id: string): Task {
  return schedule(ctx, id, today(ctx))
}

/** The My Day list for `date`: scheduled live tasks (done and cancelled included) in day order. */
export function dayView(ctx: Ctx, date: ISODate): DayView {
  const marks = marksOn(ctx, date)
  const stats = subtreeStats(liveKids(ctx))
  const items: DayItem[] = liveOnDay(ctx, date).map((task) => {
    const s = stats.get(task.id)!
    return {
      task,
      path: pathOf(ctx, task.id),
      mark: marks.get(task.id) ?? null,
      doneCount: s.done,
      totalCount: s.total,
    }
  })
  return {
    date,
    items,
    doneCount: items.filter((i) => i.task.status === 'done').length,
    totalCount: items.filter((i) => i.task.status !== 'cancelled').length,
  }
}

/** Open live tasks per date, every date in [from, to] present. */
export function dayCounts(ctx: Ctx, from: ISODate, to: ISODate): Record<ISODate, number> {
  const counts: Record<ISODate, number> = {}
  for (let d = from; d <= to; d = addDays(d, 1)) counts[d] = 0
  const rows = ctx.db.all<{ scheduled_on: string; n: number }>(
    `SELECT scheduled_on, COUNT(*) AS n FROM tasks
     WHERE scheduled_on BETWEEN ? AND ? AND status = 'open' AND deleted_at IS NULL
     GROUP BY scheduled_on`,
    from,
    to,
  )
  for (const r of rows) counts[r.scheduled_on] = r.n
  return counts
}
