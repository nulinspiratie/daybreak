import type { Ctx } from './ctx'
import { nowIso, today } from './ctx'
import { transaction } from './db/adapter'
import { addDays, type ISODate } from './dates'
import { DaybreakError } from './errors'
import { recordEvent } from './events'
import { lastWorkedBefore } from './tasks/marks'
import { pathOf } from './tasks/rows'
import { dayView, schedule, scheduleToday } from './tasks/schedule'
import { setStatus } from './tasks/status'
import { liveKids } from './tasks/tree'
import type { ReviewChoice, ReviewItem, ReviewView, Status, Task } from './types'

const SUGGESTION_CAP = 5
const RECENT_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const CHOICES: ReviewChoice[] = ['today', 'day', 'backlog', 'cancel']

type Group = ReviewItem['group']

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)

/** A review decision event that has not been undone. */
interface Decision {
  eventId: number
  taskId: string
  choice: ReviewChoice
  group: Group
  previous: { scheduledOn: ISODate | null; dayPosition: string | null; status: Status; closedAt: string | null }
  to?: ISODate
  closedIds?: string[]
}

/** Decisions made in the review of `date`, oldest first, skipping undone ones. */
function decisionsOn(ctx: Ctx, date: ISODate): Decision[] {
  const rows = ctx.db.all<{ id: number; task_id: string; kind: string; data: string }>(
    `SELECT e.id, e.task_id, e.kind, e.data FROM events e
     WHERE e.kind IN ('review_today', 'review_day', 'review_backlog', 'review_cancel')
       AND json_extract(e.data, '$.reviewDate') = ?
       AND NOT EXISTS (SELECT 1 FROM events u
                       WHERE u.kind = 'review_undo' AND json_extract(u.data, '$.undoneEventId') = e.id)
     ORDER BY e.id`,
    date,
  )
  return rows.map((r) => {
    const data = JSON.parse(r.data)
    return {
      eventId: r.id,
      taskId: r.task_id,
      choice: r.kind.slice('review_'.length) as ReviewChoice,
      group: data.group,
      previous: data.previous,
      to: data.to,
      closedIds: data.closedIds,
    }
  })
}

/** Open live tasks scheduled before `date`, oldest day first. */
function overdue(ctx: Ctx, date: ISODate, byId: Map<string, Task>): Task[] {
  const rows = ctx.db.all<{ id: string }>(
    `SELECT id FROM tasks WHERE scheduled_on < ? AND status = 'open' AND deleted_at IS NULL
     ORDER BY scheduled_on, day_position, id`,
    date,
  )
  return rows.map((r) => byId.get(r.id)!)
}

/** Fresh suggestions in order: one leaf per recently active project, then old Inbox tasks. */
function candidates(
  ctx: Ctx,
  date: ISODate,
  kids: Map<string | null, Task[]>,
  exclude: Set<string>,
  usedProjects: Set<string>,
): Task[] {
  const active = new Set(
    ctx.db
      .all<{ task_id: string }>(
        // The review's own events are not activity (Ruling R11).
        `SELECT DISTINCT task_id FROM events
         WHERE task_id IS NOT NULL AND date BETWEEN ? AND ? AND substr(kind, 1, 7) != 'review_'`,
        addDays(date, -RECENT_DAYS),
        date,
      )
      .map((r) => r.task_id),
  )
  const subtree = (t: Task): Task[] => [t, ...(kids.get(t.id) ?? []).flatMap(subtree)]
  const isLeaf = (t: Task) => !(kids.get(t.id) ?? []).some((c) => c.status === 'open')
  const eligible = (t: Task) => t.status === 'open' && t.scheduledOn === null && !exclude.has(t.id)

  const roots = kids.get(null) ?? []
  const out: Task[] = []
  for (const project of roots) {
    if (project.section !== 'projects' || usedProjects.has(project.id)) continue
    const tasks = subtree(project)
    if (!tasks.some((t) => active.has(t.id))) continue
    const leaf = tasks.find((t) => eligible(t) && isLeaf(t))
    if (leaf) out.push(leaf)
  }

  const cutoff = new Date(nowIso(ctx)).getTime() - RECENT_DAYS * DAY_MS
  const oldInbox = roots
    .filter((t) => t.section === 'inbox' && eligible(t) && new Date(t.createdAt).getTime() < cutoff)
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id))
  return [...out, ...oldInbox]
}

export function lastReviewDate(ctx: Ctx): string | null {
  return ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_review_date'")?.value ?? null
}

function setLastReviewDate(ctx: Ctx, date: ISODate): void {
  ctx.db.run(
    `INSERT INTO meta (key, value) VALUES ('last_review_date', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    date,
  )
}

/**
 * The morning review for `date`: leftovers (open tasks scheduled before it) and up to
 * five suggestions. Items decided in this review keep their row, listed first in
 * decision order, rebuilt from the decision events.
 */
export function reviewView(ctx: Ctx, date: ISODate): ReviewView {
  const kids = liveKids(ctx)
  const byId = new Map<string, Task>()
  for (const list of kids.values()) for (const t of list) byId.set(t.id, t)
  const decisions = decisionsOn(ctx, date).filter((d) => byId.has(d.taskId))
  const decided = new Set(decisions.map((d) => d.taskId))

  const item = (task: Task, group: Group, d?: Decision): ReviewItem => ({
    task,
    path: pathOf(ctx, task.id),
    group,
    decision: d ? { choice: d.choice, ...(d.to !== undefined ? { date: d.to } : {}) } : null,
    workedOn: lastWorkedBefore(ctx, task.id, date),
    scheduledOn: task.scheduledOn,
    leftoverFrom: group === 'leftover' ? (d ? d.previous.scheduledOn : task.scheduledOn) : null,
  })
  const decidedIn = (group: Group) =>
    decisions.filter((d) => d.group === group).map((d) => item(byId.get(d.taskId)!, group, d))

  const leftovers = [
    ...decidedIn('leftover'),
    ...overdue(ctx, date, byId)
      .filter((t) => !decided.has(t.id))
      .map((t) => item(t, 'leftover')),
  ]

  const decidedSuggestions = decidedIn('suggestion')
  const exclude = new Set([...decided, ...leftovers.map((i) => i.task.id)])
  const usedProjects = new Set<string>()
  for (const { task } of decidedSuggestions) {
    let root = task
    while (root.parentId !== null) root = byId.get(root.parentId)!
    if (root.section === 'projects') usedProjects.add(root.id)
  }
  const room = Math.max(0, SUGGESTION_CAP - decidedSuggestions.length)
  const suggestions = [
    ...decidedSuggestions,
    ...candidates(ctx, date, kids, exclude, usedProjects)
      .slice(0, room)
      .map((t) => item(t, 'suggestion')),
  ]

  const skipped =
    ctx.db.get(
      "SELECT 1 FROM events WHERE kind = 'review_skip' AND json_extract(data, '$.reviewDate') = ?",
      date,
    ) !== undefined
  const all = [...leftovers, ...suggestions]
  return {
    date,
    leftovers,
    suggestions,
    sortedCount: all.filter((i) => i.decision !== null).length,
    totalCount: all.length,
    todayCount: dayView(ctx, date).totalCount,
    finished: lastReviewDate(ctx) === date && !skipped,
    skipped,
  }
}

/** Apply a review choice to an undecided item of the review and record it for undo. */
export function decide(
  ctx: Ctx,
  date: ISODate,
  taskId: string,
  choice: ReviewChoice,
  targetDate?: ISODate,
): ReviewView {
  if (!CHOICES.includes(choice)) throw new DaybreakError('invalid', `Unknown review choice: ${choice}`)
  if (choice === 'day' && targetDate === undefined) {
    throw new DaybreakError('invalid', 'Another day needs a target date')
  }
  return transaction(ctx.db, () => {
    const view = reviewView(ctx, date)
    const current = [...view.leftovers, ...view.suggestions].find((i) => i.task.id === taskId)
    if (!current || current.decision !== null) {
      throw new DaybreakError('invalid', `Task #${taskId} is not waiting for a decision in this review`, {
        id: taskId,
      })
    }
    const { task, group } = current
    const data: Record<string, unknown> = {
      reviewDate: date,
      group,
      previous: {
        scheduledOn: task.scheduledOn,
        dayPosition: task.dayPosition,
        status: task.status,
        closedAt: task.closedAt,
      },
    }
    if (choice === 'today') data.to = scheduleToday(ctx, taskId).scheduledOn
    if (choice === 'day') data.to = schedule(ctx, taskId, targetDate!).scheduledOn
    if (choice === 'backlog' && group === 'leftover') schedule(ctx, taskId, null)
    if (choice === 'cancel') {
      data.closedIds = setStatus(ctx, taskId, 'cancelled', { withOpenDescendants: true }).changedIds
    }
    recordEvent(ctx, `review_${choice}`, taskId, data)
    return reviewView(ctx, date)
  })
}

/**
 * Revert the latest decision of the review of `date` that is not undone yet.
 * Reads only events, so it works after a restart. Nothing to undo is a no-op.
 */
export function undoDecision(ctx: Ctx, date: ISODate): ReviewView {
  return transaction(ctx.db, () => {
    const last = decisionsOn(ctx, date).at(-1)
    if (last) {
      const p = last.previous
      const now = nowIso(ctx)
      // "Not today" on a suggestion changed no task data, so undo writes no row (Ruling R12).
      const changedTask = !(last.choice === 'backlog' && last.group === 'suggestion')
      if (changedTask) {
        ctx.db.run(
          `UPDATE tasks SET scheduled_on = ?, day_position = ?, status = ?, closed_at = ?, updated_at = ?
           WHERE id = ?`,
          p.scheduledOn,
          p.dayPosition,
          p.status,
          p.closedAt,
          now,
          last.taskId,
        )
      }
      // A cancel closed the open subtree with it; reopen exactly those (Ruling R4).
      for (const id of last.closedIds ?? []) {
        if (id === last.taskId) continue
        ctx.db.run(
          "UPDATE tasks SET status = 'open', closed_at = NULL, updated_at = ? WHERE id = ? AND status != 'open'",
          now,
          id,
        )
      }
      recordEvent(ctx, 'review_undo', last.taskId, { undoneEventId: last.eventId })
    }
    return reviewView(ctx, date)
  })
}

export function skipReview(ctx: Ctx, date: ISODate): void {
  transaction(ctx.db, () => {
    recordEvent(ctx, 'review_skip', null, { reviewDate: date })
    setLastReviewDate(ctx, date)
  })
}

export function finishReview(ctx: Ctx, date: ISODate): void {
  setLastReviewDate(ctx, date)
}

/** True when today's review was neither finished nor skipped and has something in it. */
export function needsReview(ctx: Ctx): boolean {
  const date = today(ctx)
  if (lastReviewDate(ctx) === date) return false
  return reviewView(ctx, date).totalCount > 0
}
