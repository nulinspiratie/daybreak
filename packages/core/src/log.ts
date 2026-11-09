import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ctx } from './ctx'
import { today } from './ctx'
import { addDays, weekdayName, type ISODate } from './dates'
import { eventsOn, type EventRow } from './events'
import { decisionsLeaving, type Decision } from './review'
import { marksOn } from './tasks/marks'
import { pathOf, rowToTask, TASK_COLUMNS, type TaskRow } from './tasks/rows'
import type { Task } from './types'

/** A line of the log: the task, the event id that put it in its section, and the outcome suffix. */
interface Entry {
  task: Task
  order: number
  suffix: string
}

function lastLoggedDate(ctx: Ctx): ISODate | null {
  return ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_logged_date'")?.value ?? null
}

function setLastLoggedDate(ctx: Ctx, date: ISODate): void {
  ctx.db.run(
    `INSERT INTO meta (key, value) VALUES ('last_logged_date', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    date,
  )
}

function outcome(d: Decision): string {
  switch (d.choice) {
    case 'today':
      return ` → moved to ${d.reviewDate}`
    case 'day':
      return ` → moved to ${d.to}`
    case 'backlog':
      return ' → backlog'
    case 'cancel':
      return ' → cancelled'
  }
}

/**
 * The task's scheduled day just after event `eventId`: the `from` of its next
 * (un)schedule event, else its current day.
 */
function scheduledOnAfter(ctx: Ctx, task: Task, eventId: number): ISODate | null {
  const next = ctx.db.get<{ data: string }>(
    `SELECT data FROM events WHERE task_id = ? AND kind IN ('scheduled', 'unscheduled') AND id > ?
     ORDER BY id LIMIT 1`,
    task.id,
    eventId,
  )
  return next ? (JSON.parse(next.data).from ?? null) : task.scheduledOn
}

/** Per task, the last of its events with one of `kinds`, in event order. */
function lastByTask(events: EventRow[], kinds: string[]): EventRow[] {
  const last = new Map<string, EventRow>()
  for (const e of events) if (e.taskId !== null && kinds.includes(e.kind)) last.set(e.taskId, e)
  return [...last.values()].sort((a, b) => a.id - b.id)
}

/**
 * The Markdown log for `date` (SPEC §6), or null when the day has no events or
 * nothing to list. Titles and paths are read now; deleted tasks are left out.
 * Each task appears once across Done, Worked on and Not done, in that precedence.
 */
export function buildDayLog(ctx: Ctx, date: ISODate): string | null {
  const events = eventsOn(ctx, date)
  if (events.length === 0) return null

  const live = new Map<string, Task | null>()
  const liveTask = (id: string): Task | null => {
    if (!live.has(id)) {
      const row = ctx.db.get<TaskRow>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`, id)
      live.set(id, row && row.deleted_at === null ? rowToTask(row) : null)
    }
    return live.get(id)!
  }

  const decisions = new Map<string, Decision>()
  for (const d of decisionsLeaving(ctx, date)) decisions.set(d.taskId, d)
  const decisionSuffix = (id: string) => {
    const d = decisions.get(id)
    return d ? outcome(d) : ''
  }

  const done: Entry[] = []
  for (const e of lastByTask(events, ['done', 'reopened'])) {
    const task = liveTask(e.taskId!)
    if (task && e.kind === 'done') done.push({ task, order: e.id, suffix: '' })
  }
  const listed = new Set(done.map((x) => x.task.id))

  const firstMark = new Map<string, number>()
  for (const e of events) {
    if (e.taskId !== null && (e.kind === 'worked' || e.kind === 'doing') && !firstMark.has(e.taskId)) {
      firstMark.set(e.taskId, e.id)
    }
  }
  const worked: Entry[] = []
  for (const id of marksOn(ctx, date).keys()) {
    const task = liveTask(id)
    if (!task || listed.has(id)) continue
    worked.push({ task, order: firstMark.get(id) ?? Number.MAX_SAFE_INTEGER, suffix: decisionSuffix(id) })
  }
  worked.sort((a, b) => a.order - b.order || (a.task.id < b.task.id ? -1 : 1))
  for (const x of worked) listed.add(x.task.id)

  const missed = new Map<string, Entry>()
  // Cancelled during the day while scheduled on it (Ruling R43).
  for (const e of lastByTask(events, ['cancelled', 'reopened'])) {
    const task = liveTask(e.taskId!)
    if (!task || e.kind !== 'cancelled' || listed.has(task.id)) continue
    if (scheduledOnAfter(ctx, task, e.id) === date) missed.set(task.id, { task, order: e.id, suffix: ' → cancelled' })
  }
  for (const d of decisions.values()) {
    const task = liveTask(d.taskId)
    if (task && !listed.has(task.id)) missed.set(task.id, { task, order: d.eventId, suffix: outcome(d) })
  }
  const notDone = [...missed.values()].sort((a, b) => a.order - b.order)
  for (const x of notDone) listed.add(x.task.id)
  const stillScheduled = ctx.db.all<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE scheduled_on = ? AND status = 'open' AND deleted_at IS NULL ORDER BY day_position, id`,
    date,
  )
  for (const row of stillScheduled) {
    if (!listed.has(row.id)) notDone.push({ task: rowToTask(row), order: 0, suffix: '' })
  }

  const added: Entry[] = []
  for (const e of events) {
    const task = e.kind === 'created' && e.taskId !== null ? liveTask(e.taskId) : null
    if (task) added.push({ task, order: e.id, suffix: '' })
  }

  const line = (box: string) => (x: Entry) => {
    const path = pathOf(ctx, x.task.id)
    const where = (path.length > 0 ? path : ['Projects']).join(' › ')
    return `- ${box}${x.task.title} · ${where} (#${x.task.id})${x.suffix}`
  }
  const sections: [string, Entry[], string][] = [
    ['Done', done, '[x] '],
    ['Worked on', worked, '[~] '],
    ['Not done', notDone, '[ ] '],
    ['Added', added, ''],
  ]
  const body = sections
    .filter(([, entries]) => entries.length > 0)
    .map(([heading, entries, box]) => [`## ${heading}`, ...entries.map(line(box))].join('\n'))
  if (body.length === 0) return null
  return [`# ${date} · ${weekdayName(date, 'long')}`, ...body].join('\n\n') + '\n'
}

/** Write `text` to a temp file next to `file`, then rename it into place. */
function writeAtomically(file: string, text: string): void {
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/**
 * Write `<logsDir>/<date>.md` for every day after meta.last_logged_date and
 * before today that has events, then move last_logged_date up to yesterday.
 * Days with nothing to list get no file. A write error is reported and stops
 * here, leaving last_logged_date just before the failed day. Returns the days written.
 */
export function writeMissingLogs(ctx: Ctx, logsDir: string): ISODate[] {
  const last = lastLoggedDate(ctx)
  const end = today(ctx)
  const days = ctx.db
    .all<{ date: string }>(
      'SELECT DISTINCT date FROM events WHERE date > ? AND date < ? ORDER BY date',
      last ?? '',
      end,
    )
    .map((r) => r.date)

  const written: ISODate[] = []
  let frozenThrough = addDays(end, -1)
  for (const date of days) {
    const text = buildDayLog(ctx, date)
    if (text === null) continue
    try {
      mkdirSync(logsDir, { recursive: true })
      writeAtomically(join(logsDir, `${date}.md`), text)
    } catch (err) {
      console.error(`Daybreak: could not write the log for ${date}:`, err)
      frozenThrough = addDays(date, -1)
      break
    }
    written.push(date)
  }
  if (last === null || frozenThrough > last) setLastLoggedDate(ctx, frozenThrough)
  return written
}
