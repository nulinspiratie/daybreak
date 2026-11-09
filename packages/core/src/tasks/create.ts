import type { Ctx } from '../ctx'
import { nowIso } from '../ctx'
import type { ISODate } from '../dates'
import { transaction } from '../db/adapter'
import { DaybreakError } from '../errors'
import { recordEvent } from '../events'
import { newId } from '../ids'
import type { Section, Task } from '../types'
import { positionFor } from './positions'
import { getTask, liveChildren } from './rows'
import { dayPositionFor } from './schedule'

export function normalizeTitle(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').trim()
}

function requireTitle(raw: string): string {
  const title = normalizeTitle(raw)
  if (title === '') throw new DaybreakError('invalid', 'Title cannot be empty')
  return title
}

export interface CreateInput {
  title: string
  section: Section
  parentId?: string | null
  afterId?: string
  beforeId?: string
  scheduledOn?: ISODate | null
}

export function createTask(ctx: Ctx, input: CreateInput): Task {
  const title = requireTitle(input.title)
  const parentId = input.parentId ?? null
  if (input.section === 'inbox' && parentId !== null) {
    throw new DaybreakError('invalid', 'Inbox tasks cannot have a parent')
  }
  return transaction(ctx.db, () => {
    if (parentId !== null) {
      const parent = getTask(ctx, parentId)
      if (parent.section !== 'projects') {
        throw new DaybreakError('invalid', `#${parentId} is not a project task`)
      }
    }
    const position = positionFor(liveChildren(ctx, parentId, input.section), {
      afterId: input.afterId,
      beforeId: input.beforeId,
    })
    const scheduledOn = input.scheduledOn ?? null
    let dayPosition: string | null = null
    if (scheduledOn !== null) {
      dayPosition = dayPositionFor(ctx, scheduledOn, {})
    }
    const id = newId()
    const now = nowIso(ctx)
    ctx.db.run(
      `INSERT INTO tasks (id, parent_id, section, position, title, scheduled_on, day_position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      parentId,
      input.section,
      position,
      title,
      scheduledOn,
      dayPosition,
      now,
      now,
    )
    recordEvent(ctx, 'created', id, { title, section: input.section, parentId })
    return getTask(ctx, id)
  })
}

export interface TaskPatch {
  title?: string
  notes?: string
  link?: string | null
  collapsed?: boolean
  tags?: string[]
}

export function updateTask(ctx: Ctx, id: string, patch: TaskPatch): Task {
  return transaction(ctx.db, () => {
    const task = getTask(ctx, id)
    const sets: string[] = []
    const params: (string | number | null)[] = []
    let renamed: string | null = null
    if (patch.title !== undefined) {
      const title = requireTitle(patch.title)
      sets.push('title = ?')
      params.push(title)
      if (title !== task.title) renamed = title
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?')
      params.push(patch.notes)
    }
    if (patch.link !== undefined) {
      sets.push('link = ?')
      params.push(patch.link)
    }
    if (patch.collapsed !== undefined) {
      sets.push('collapsed = ?')
      params.push(patch.collapsed ? 1 : 0)
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?')
      params.push(JSON.stringify(patch.tags))
    }
    sets.push('updated_at = ?')
    params.push(nowIso(ctx), id)
    ctx.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...params)
    if (renamed !== null) recordEvent(ctx, 'renamed', id, { from: task.title, to: renamed })
    return getTask(ctx, id)
  })
}
