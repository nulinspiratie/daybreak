import type { Ctx } from './ctx'
import { nowIso, today } from './ctx'
import type { ISODate } from './dates'
import type { EventKind } from './types'

export interface EventRow {
  id: number
  at: string
  date: ISODate
  taskId: string | null
  kind: EventKind
  // biome-ignore lint/suspicious/noExplicitAny: the payload's shape depends on `kind`; readers narrow it by kind.
  data: any
}

interface RawEvent {
  id: number
  at: string
  date: string
  task_id: string | null
  kind: string
  data: string | null
}

function toRow(r: RawEvent): EventRow {
  return {
    id: r.id,
    at: r.at,
    date: r.date,
    taskId: r.task_id,
    kind: r.kind as EventKind,
    data: r.data ? JSON.parse(r.data) : {},
  }
}

const COLUMNS = 'id, at, date, task_id, kind, data'

export function recordEvent(
  ctx: Ctx,
  kind: EventKind,
  taskId: string | null,
  data: object = {},
): EventRow {
  ctx.db.run(
    'INSERT INTO events (at, date, task_id, kind, data) VALUES (?, ?, ?, ?, ?)',
    nowIso(ctx),
    today(ctx),
    taskId,
    kind,
    JSON.stringify(data),
  )
  // The adapter has no lastInsertRowid; the id is per-connection, so this is safe.
  const row = ctx.db.get<RawEvent>(
    `SELECT ${COLUMNS} FROM events WHERE id = (SELECT last_insert_rowid())`,
  )!
  return toRow(row)
}

export function eventsOn(ctx: Ctx, date: ISODate): EventRow[] {
  return ctx.db
    .all<RawEvent>(`SELECT ${COLUMNS} FROM events WHERE date = ? ORDER BY id`, date)
    .map(toRow)
}

export function eventsSince(ctx: Ctx, date: ISODate): EventRow[] {
  return ctx.db
    .all<RawEvent>(`SELECT ${COLUMNS} FROM events WHERE date >= ? ORDER BY id`, date)
    .map(toRow)
}
