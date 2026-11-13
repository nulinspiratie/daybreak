import { existsSync, linkSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ctx } from './ctx'
import { today } from './ctx'
import { addDays, type ISODate, weekdayName } from './dates'
import { type EventRow, eventsOn } from './events'
import { type Decision, decisionsLeaving } from './review'
import { marksOn } from './tasks/marks'
import { pathOf, rowToTask, TASK_COLUMNS, type TaskRow } from './tasks/rows'
import type { Task } from './types'

/** Chronological sort key: the event's id, then the task's place in that event's cascade. */
type Order = [eventId: number, index: number]

/** A line of the log: the task, the event that put it in its section, and the outcome suffix. */
interface Entry {
  task: Task
  order: Order
  suffix: string
}

const byOrder = (a: Entry, b: Entry) => a.order[0] - b.order[0] || a.order[1] - b.order[1]

function lastLoggedDate(ctx: Ctx): ISODate | null {
  return (
    ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_logged_date'")?.value ??
    null
  )
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
    case 'done':
      return ' → done'
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

interface CloseState {
  kind: 'done' | 'cancelled' | 'reopened'
  order: Order
}

/**
 * Each task's close state at the end of the day: the last done, cancelled or
 * reopened event that touched it (Ruling R45). A close touches every id in its
 * `closedIds`, in tree order (Ruling R46); a reopen touches its `ids`. Undoing a
 * review cancel or done reopens exactly what it closed.
 */
function closeStates(events: EventRow[]): Map<string, CloseState> {
  const byId = new Map(events.map((e) => [e.id, e]))
  const states = new Map<string, CloseState>()
  const touch = (e: EventRow, kind: CloseState['kind'], ids: string[]) =>
    ids.forEach((id, i) => {
      states.set(id, { kind, order: [e.id, i] })
    })
  for (const e of events) {
    if (e.taskId === null) continue
    if (e.kind === 'done' || e.kind === 'cancelled')
      touch(e, e.kind, e.data.closedIds ?? [e.taskId])
    if (e.kind === 'reopened') touch(e, 'reopened', e.data.ids ?? [e.taskId])
    if (e.kind === 'review_undo') {
      const undone = byId.get(e.data.undoneEventId)
      if (undone?.kind === 'review_cancel' || undone?.kind === 'review_done')
        touch(e, 'reopened', undone.data.closedIds ?? [undone.taskId!])
    }
  }
  return states
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

  const closes = [...closeStates(events)].flatMap(([id, state]) => {
    const task = liveTask(id)
    return task ? [{ task, ...state }] : []
  })
  const done: Entry[] = closes
    .filter((c) => c.kind === 'done')
    .map(({ task, order }) => ({ task, order, suffix: '' }))
    .sort(byOrder)
  const listed = new Set(done.map((x) => x.task.id))

  const firstMark = new Map<string, number>()
  for (const e of events) {
    if (
      e.taskId !== null &&
      (e.kind === 'worked' || e.kind === 'doing') &&
      !firstMark.has(e.taskId)
    ) {
      firstMark.set(e.taskId, e.id)
    }
  }
  const worked: Entry[] = []
  for (const id of marksOn(ctx, date).keys()) {
    const task = liveTask(id)
    if (!task || listed.has(id)) continue
    worked.push({
      task,
      order: [firstMark.get(id) ?? Number.MAX_SAFE_INTEGER, 0],
      suffix: decisionSuffix(id),
    })
  }
  worked.sort((a, b) => byOrder(a, b) || (a.task.id < b.task.id ? -1 : 1))
  for (const x of worked) listed.add(x.task.id)

  const missed = new Map<string, Entry>()
  // Ended the day cancelled, and was scheduled on it when cancelled (Rulings R43, R45, R46).
  for (const { task, kind, order } of closes) {
    if (kind !== 'cancelled' || listed.has(task.id)) continue
    if (scheduledOnAfter(ctx, task, order[0]) === date)
      missed.set(task.id, { task, order, suffix: ' → cancelled' })
  }
  for (const d of decisions.values()) {
    const task = liveTask(d.taskId)
    if (task && !listed.has(task.id))
      missed.set(task.id, { task, order: [d.eventId, 0], suffix: outcome(d) })
  }
  const notDone = [...missed.values()].sort(byOrder)
  for (const x of notDone) listed.add(x.task.id)
  const stillScheduled = ctx.db.all<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE scheduled_on = ? AND status = 'open' AND deleted_at IS NULL ORDER BY day_position, id`,
    date,
  )
  for (const row of stillScheduled) {
    if (!listed.has(row.id)) notDone.push({ task: rowToTask(row), order: [0, 0], suffix: '' })
  }

  const added: Entry[] = []
  for (const e of events) {
    const task = e.kind === 'created' && e.taskId !== null ? liveTask(e.taskId) : null
    if (task) added.push({ task, order: [e.id, 0], suffix: '' })
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
  return `${[`# ${date} · ${weekdayName(date, 'long')}`, ...body].join('\n\n')}\n`
}

/** Error codes for a file system without hard links (e.g. FAT). */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])

/**
 * Publish `text` as `file` without ever replacing an existing file: write a
 * temp file, then hard-link it into place (EEXIST means the log is already
 * there). Returns false when the file already existed.
 *
 * Never clobbering is what makes a re-run harmless when the review transaction
 * rolls back after the files were written, or when last_logged_date is reset.
 */
function publishOnce(file: string, text: string): boolean {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  try {
    linkSync(tmp, file)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ''
    if (code === 'EEXIST') return false
    if (!NO_HARD_LINKS.has(code)) throw err
    if (existsSync(file)) return false
    renameSync(tmp, file)
    return true
  } finally {
    rmSync(tmp, { force: true })
  }
}

/**
 * Write `<logsDir>/<date>.md` for every day after meta.last_logged_date and
 * before today that has events, then move last_logged_date up to yesterday.
 * Days with nothing to list get no file, and a file that already exists is
 * kept as it is: logs are never changed. A write error is reported and stops
 * here, leaving last_logged_date just before the failed day. Returns the days
 * written by this call.
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
      if (publishOnce(join(logsDir, `${date}.md`), text)) written.push(date)
    } catch (err) {
      console.error(`Daybreak: could not write the log for ${date}:`, err)
      frozenThrough = addDays(date, -1)
      break
    }
  }
  if (last === null || frozenThrough > last) setLastLoggedDate(ctx, frozenThrough)
  return written
}
