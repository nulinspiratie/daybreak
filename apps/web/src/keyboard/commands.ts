import type { DayItem, DayView, ISODate, Mark, MoveTarget, Task } from '@daybreak/core'
import { ApiError, type api } from '../api/client'
import type { useMutate } from '../api/hooks'
import type { ToastApi } from '../shell/toastStore'
import { blankNode, DRAFT_ID, type FlatRow } from '../tree/flatten'
import {
  failPendingId,
  liveId,
  pendingId,
  placementFor,
  resolveId,
  SkippedWrite,
  settlePendingId,
  type TreeCache,
} from '../tree/optimistic'
import type { Draft, UiActions, UiState } from '../ui/store'
import { recorded, type UndoEntry, undoHistory } from '../undo/history'
import type { Command } from './keymap'

/** How long the "Press Space again" note waits for the second press. */
export const CONFIRM_MS = 4000

export interface CommandEnv {
  rows: FlatRow[]
  dayItems: DayItem[]
  /** A snapshot taken when the key was pressed; writes go through `ui.set`. */
  ui: UiState & UiActions
  api: typeof api
  /** Shows new tasks and titles before the server's answer is refetched. */
  cache: TreeCache
  mutate: ReturnType<typeof useMutate>
  /** The task the detail panel shows, whether or not the tree lists it (R35). */
  detailTask?: Task
  today: ISODate
  now: () => number
  toast: ToastApi
}

type Confirm = NonNullable<UiState['confirm']>
type Pane = UiState['pane']
type Closed = Confirm['status']

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const andSubtasks = (n: number) => (n > 0 ? ` and ${plural(n, 'subtask')}` : '')

/** The note under a parent row after the first Space or X. */
export function confirmNoteText(c: Confirm): string {
  const open = plural(c.openCount, 'open subtask')
  return c.status === 'done'
    ? `${open}. Press Space again to close them all.`
    : `${open}. Press X again to cancel them all.`
}

interface Target {
  id: string
  task: Task
  /** Set in the tree. */
  row?: FlatRow
}

// The draft row only exists in edit mode; navigate-mode commands skip it.
const treeRows = (env: CommandEnv) => env.rows.filter((r) => !r.isDraft)

function paneIdsFor(env: CommandEnv, pane: 'tree' | 'day'): string[] {
  return pane === 'tree' ? treeRows(env).map((r) => r.id) : env.dayItems.map((i) => i.task.id)
}

const paneIds = (env: CommandEnv) => paneIdsFor(env, env.ui.pane)

function selectedId(env: CommandEnv): string | null {
  return env.ui.pane === 'tree' ? env.ui.treeSel : env.ui.daySel
}

function select(env: CommandEnv, id: string | null): void {
  env.ui.set(env.ui.pane === 'tree' ? { treeSel: id } : { daySel: id })
}

function target(env: CommandEnv): Target | null {
  const id = selectedId(env)
  if (id === null) return null
  if (env.ui.pane === 'tree') {
    const row = treeRows(env).find((r) => r.id === id)
    return row ? { id, task: row.node, row } : null
  }
  const item = env.dayItems.find((i) => i.task.id === id)
  return item ? { id, task: item.task } : null
}

/** Commands on the shown task rather than the tree selection while the detail panel is open (R35). */
const ON_DETAIL: ReadonlySet<Command> = new Set<Command>([
  'status.done',
  'status.cancel',
  'mark.doing',
  'mark.worked',
  'schedule.today',
  'schedule.pick',
  'schedule.backlog',
  'delete',
  'delete.task',
  'link.open',
])

function detailTarget(env: CommandEnv): Target | null {
  const { detailId, pane } = env.ui
  if (detailId === null || pane !== 'tree' || !env.detailTask || env.detailTask.id !== detailId)
    return null
  const row = treeRows(env).find((r) => r.id === detailId)
  return { id: detailId, task: row ? row.node : env.detailTask, ...(row && { row }) }
}

/** The row to select once `t` (and, in the tree, its subtree) leaves the list: the next one, else the previous. */
function neighbourAfterRemoval(env: CommandEnv, t: Target): string | null {
  if (env.ui.pane === 'tree') {
    const rows = treeRows(env)
    const i = rows.findIndex((r) => r.id === t.id)
    let j = i + 1
    while (j < rows.length && rows[j]!.depth > rows[i]!.depth) j++
    return rows[j]?.id ?? rows[i - 1]?.id ?? null
  }
  const ids = paneIds(env)
  const i = ids.indexOf(t.id)
  return ids[i + 1] ?? ids[i - 1] ?? null
}

// Built inside each queued write, so a placeholder id from a draft is already the real id (or the
// write is skipped with SkippedWrite, if the server refused to create that task).
const taskPath = (id: string, action = '') => `/api/tasks/${liveId(id)}${action}`

// ---- Undo: where things were, and how to put them back ----

/** A task's scheduled day, and for today its neighbour in My Day's order. */
export interface DaySpot {
  date: ISODate | null
  afterId?: string
  beforeId?: string
}

/** Where `task` sits in the day plan now. Days other than today keep only the date. */
export function daySpotOf(
  env: Partial<Pick<CommandEnv, 'dayItems' | 'today'>>,
  task: Task,
): DaySpot {
  const date = task.scheduledOn
  if (date === null || date !== env.today || !env.dayItems) return { date }
  const ids = env.dayItems.map((i) => i.task.id)
  const i = ids.indexOf(task.id)
  if (i > 0) return { date, afterId: ids[i - 1]! }
  if (i === 0 && ids[1] !== undefined) return { date, beforeId: ids[1] }
  return { date }
}

/** Sends a write with a neighbour; if the neighbour has gone (400), sends it again without one. */
async function withAnchor(
  send: (anchor: { afterId?: string; beforeId?: string }) => Promise<unknown>,
  at: { afterId?: string; beforeId?: string },
): Promise<void> {
  const anchor =
    at.afterId !== undefined
      ? { afterId: resolveId(at.afterId) }
      : at.beforeId !== undefined
        ? { beforeId: resolveId(at.beforeId) }
        : {}
  try {
    await send(anchor)
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 400) || Object.keys(anchor).length === 0) throw e
    await send({})
  }
}

/** Puts a task back on the day (and place in My Day) it had. */
function putBackOnDay(env: Pick<CommandEnv, 'api'>, id: string, spot: DaySpot): Promise<void> {
  if (spot.date === null)
    return env.api.send('POST', taskPath(id, '/schedule'), { date: null }).then(() => {})
  const date = spot.date
  return withAnchor(
    (anchor) => env.api.send('POST', taskPath(id, '/schedule'), { date, ...anchor }),
    spot,
  )
}

/** A task's place in the tree, as POST /move takes it. */
export type TreePlace = MoveTarget

/** Where the visible row `id` sits: its parent and the sibling before it (or after it, if it is first). */
export function treePlaceOf(env: Pick<CommandEnv, 'rows'>, id: string): TreePlace | null {
  const rows = env.rows.filter((r) => !r.isDraft)
  const row = rows.find((r) => r.id === id)
  if (!row) return null
  const siblings = rows.filter((r) => r.parentId === row.parentId && r.section === row.section)
  const k = siblings.indexOf(row)
  const prev = siblings[k - 1]
  const next = siblings[k + 1]
  return {
    parentId: row.parentId,
    section: row.section,
    ...(prev ? { afterId: prev.id } : next ? { beforeId: next.id } : {}),
  }
}

function putBackInTree(env: Pick<CommandEnv, 'api'>, id: string, place: TreePlace): Promise<void> {
  const parentId = place.parentId === null ? null : resolveId(place.parentId)
  return withAnchor(
    (anchor) =>
      env.api.send('POST', taskPath(id, '/move'), { parentId, section: place.section, ...anchor }),
    place,
  )
}

/** Sends a move in the tree (keys or drag), recorded for undo if the task's place is known. */
function recordMove<T>(
  env: CommandEnv,
  id: string,
  title: string,
  apply: () => Promise<T>,
): Promise<T> {
  const place = treePlaceOf(env, id)
  if (!place) return env.mutate(apply)
  return recorded(
    env.mutate,
    {
      label: `Moved '${title}'`,
      revert: () => putBackInTree(env, id, place),
      select: { pane: 'tree', id },
    },
    apply,
  )
}

/** Sends a change of day (T, D, B, a drop into My Day, a reorder of My Day), recorded for undo. */
function recordSchedule<T>(
  env: Partial<Pick<CommandEnv, 'dayItems' | 'today'>> & Pick<CommandEnv, 'api' | 'mutate'>,
  task: Task,
  label: string,
  apply: () => Promise<T>,
  select?: { pane: 'tree' | 'day'; id: string },
): Promise<T> {
  const spot = daySpotOf(env, task)
  return recorded(
    env.mutate,
    { label, revert: () => putBackOnDay(env, task.id, spot), ...(select && { select }) },
    apply,
  )
}

const quoted = (t: Task) => `'${t.title}'`

/** Z (and Ctrl+Z, and the toast's Undo): reverts `id`'s change, or the newest one. */
export async function undo(env: CommandEnv, id?: number): Promise<void> {
  const entry = undoHistory.take(id)
  if (!entry) {
    env.toast.show({ message: 'Nothing to undo' })
    return
  }
  const shown = env.toast.current()
  try {
    await env.mutate(entry.revert)
  } catch (e) {
    // A task that was never created has nothing to undo; anything else is kept for another Z.
    if (!(e instanceof SkippedWrite)) undoHistory.restore(entry)
    throw e
  }
  undoHistory.undone(entry)
  if (shown?.undoId === entry.id && env.toast.current()?.id === shown.id) env.toast.dismiss()
  env.toast.show({ message: `Undone: ${entry.label}` })
  reselect(env, entry.select)
}

/** Ctrl+Shift+Z and Ctrl+Y: makes the most recently undone change again. */
export async function redo(env: CommandEnv): Promise<void> {
  const entry = undoHistory.takeRedo()
  if (!entry) {
    env.toast.show({ message: 'Nothing to redo' })
    return
  }
  try {
    await env.mutate(entry.reapply)
  } catch (e) {
    if (!(e instanceof SkippedWrite)) undoHistory.restoreRedo(entry)
    throw e
  }
  undoHistory.redone(entry)
  env.toast.show({ message: `Redone: ${entry.label}` })
  reselect(env, entry.select)
}

function reselect(env: CommandEnv, sel: UndoEntry['select']): void {
  if (!sel || sel.pane !== env.ui.pane) return
  const resolved = resolveId(sel.id)
  env.ui.set(sel.pane === 'tree' ? { treeSel: resolved } : { daySel: resolved })
}

function navigate(env: CommandEnv, cmd: 'nav.up' | 'nav.down' | 'nav.first' | 'nav.last'): void {
  const ids = paneIds(env)
  if (ids.length === 0) return
  const i = ids.indexOf(selectedId(env) ?? '')
  let j: number
  if (cmd === 'nav.first' || i < 0) j = 0
  else if (cmd === 'nav.last') j = ids.length - 1
  else j = cmd === 'nav.up' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1)
  select(env, ids[j]!)
}

/**
 * Ctrl+Shift+↑↓ in the tree: the nearest row above (or below) at the same level or higher, so
 * nested rows are skipped. Up is the previous sibling, else the parent; down is the next sibling,
 * else the row after the parent's subtree. My Day is flat, so there it is ↑↓.
 */
function navigateLevel(env: CommandEnv, dir: 'up' | 'down'): void {
  if (env.ui.pane === 'day') {
    navigate(env, dir === 'up' ? 'nav.up' : 'nav.down')
    return
  }
  const rows = treeRows(env)
  const i = rows.findIndex((r) => r.id === env.ui.treeSel)
  if (i < 0) {
    navigate(env, 'nav.first')
    return
  }
  const depth = rows[i]!.depth
  const step = dir === 'up' ? -1 : 1
  let j = i + step
  while (j >= 0 && j < rows.length && rows[j]!.depth > depth) j += step
  if (rows[j]) select(env, rows[j]!.id)
}

/** The day picker's choice: schedule at the end of that day, or take the task off its day (null). Picking the current day does nothing, like T. */
export function pickDay(
  env: Pick<CommandEnv, 'api' | 'mutate'> & Partial<Pick<CommandEnv, 'dayItems' | 'today'>>,
  t: Task,
  date: ISODate | null,
): Promise<unknown> {
  if (t.scheduledOn === date) return Promise.resolve()
  const label =
    date === null
      ? `Took ${quoted(t)} off its day`
      : date === env.today
        ? `Scheduled ${quoted(t)} for today`
        : `Scheduled ${quoted(t)} for ${date}`
  return recordSchedule(env, t, label, () =>
    env.api.send('POST', taskPath(t.id, '/schedule'), { date }),
  )
}

/** Drag and drop in the tree: the task and its subtree go to `to` (POST /move), then `expand` opens the new parent. */
export function moveTo(
  env: CommandEnv,
  id: string,
  to: MoveTarget,
  expand = false,
): Promise<unknown> {
  const title = env.rows.find((r) => r.id === id)?.node.title ?? 'task'
  return recordMove(env, id, title, async () => {
    // Resolved now, inside the queue: an anchor may be a task whose create was only just answered.
    const { section, parentId, afterId, beforeId } = placementFor(to)
    const body: MoveTarget = {
      parentId,
      section,
      ...(afterId !== undefined && { afterId }),
      ...(beforeId !== undefined && { beforeId }),
    }
    await env.api.send('POST', taskPath(id, '/move'), body)
    if (expand && parentId !== null)
      await env.api.send('PATCH', taskPath(parentId), { collapsed: false })
  })
}

/** Drag and drop into My Day: schedule on `date` next to `at.afterId` or `at.beforeId` (at the end with neither). */
export function scheduleAt(
  env: CommandEnv,
  id: string,
  date: ISODate,
  at: { afterId?: string; beforeId?: string },
): Promise<unknown> {
  const task =
    env.dayItems.find((i) => i.task.id === id)?.task ?? env.rows.find((r) => r.id === id)?.node
  const apply = () => {
    const anchor =
      at.afterId !== undefined
        ? { afterId: resolveId(at.afterId) }
        : at.beforeId !== undefined
          ? { beforeId: resolveId(at.beforeId) }
          : {}
    return env.api.send('POST', taskPath(id, '/schedule'), { date, ...anchor })
  }
  if (!task) return env.mutate(apply)
  const label =
    task.scheduledOn === date
      ? `Moved ${quoted(task)} in My Day`
      : `Added ${quoted(task)} to My Day`
  return recordSchedule(env, task, label, apply, { pane: 'day', id })
}

/** Takes a task off today: B or Del in My Day, or a My Day row dragged onto the tree. Shows the undo toast. */
export function removeFromDay(env: CommandEnv, task: Task): Promise<unknown> {
  if (task.scheduledOn === null) return Promise.resolve()
  const label = `Removed ${quoted(task)} from My Day`
  const done = recordSchedule(
    env,
    task,
    label,
    () => env.api.send('POST', taskPath(task.id, '/schedule'), { date: null }),
    { pane: 'day', id: task.id },
  )
  env.toast.show({ message: label, undoId: lastUndoId() })
  return done
}

/** The id of the change just recorded, for a toast that offers to undo it. */
const lastUndoId = () => undoHistory.peek()?.id

/** My Day: move one slot within today's order, read fresh inside the queue so quick presses stay correct. */
async function moveInDay(env: CommandEnv, task: Task, dir: 'up' | 'down'): Promise<void> {
  const id = task.id
  const ids = env.dayItems.map((i) => i.task.id)
  const i = ids.indexOf(id)
  if (i < 0 || (dir === 'up' ? i === 0 : i === ids.length - 1)) return
  const apply = async () => {
    const day = await env.api.get<DayView>(`/api/day/${env.today}`)
    const ids = day.items.map((i) => i.task.id)
    const i = ids.indexOf(id)
    if (i < 0) return
    const at = dir === 'up' ? { beforeId: ids[i - 1] } : { afterId: ids[i + 1] }
    if (Object.values(at)[0] === undefined) return
    await env.api.send('POST', taskPath(id, '/schedule'), { date: env.today, ...at })
  }
  await recordSchedule(env, task, `Moved ${quoted(task)} in My Day`, apply, { pane: 'day', id })
}

/**
 * Space: done, or reopen if already done. X: cancel, or reopen if already cancelled (R26).
 * Closing an open parent needs a second press within 4 s (core answers 409 needs_confirmation).
 */
async function toggleClosed(env: CommandEnv, t: Target, want: Closed): Promise<void> {
  const { ui, api, mutate } = env
  const select = { pane: ui.pane, id: t.id }
  if (t.task.status === want) {
    ui.set({ confirm: null })
    let reopened = 1
    const reopen = async () => {
      const res = await api.send<{ changedIds: string[] }>('PATCH', taskPath(t.id), {
        status: 'open',
      })
      reopened = res?.changedIds?.length ?? 1
      return res
    }
    await recorded(
      mutate,
      {
        label: `Reopened ${quoted(t.task)}`,
        // Reopening brought back the subtasks closed with it; closing again takes them along.
        revert: () =>
          api.send('PATCH', taskPath(t.id), {
            status: want,
            ...(reopened > 1 && { withOpenDescendants: true }),
          }),
        select,
      },
      reopen,
    )
    return
  }
  const c = ui.confirm
  const confirmed = c !== null && c.id === t.id && c.status === want && env.now() < c.until
  const body = confirmed ? { status: want, withOpenDescendants: true } : { status: want }
  try {
    const res = await recorded(
      mutate,
      {
        label: `${want === 'done' ? 'Done' : 'Cancelled'} ${quoted(t.task)}`,
        // Back to the status it had. Reopening brings back exactly the subtasks closed with it.
        revert: () => api.send('PATCH', taskPath(t.id), { status: t.task.status }),
        select,
      },
      () => api.send<{ changedIds: string[] }>('PATCH', taskPath(t.id), body),
    )
    ui.set({ confirm: null })
    // DESIGN has one close toast: Done after closing a subtree (R27). No leaf or Cancel toasts.
    const subtasks = res.changedIds.length - 1
    if (want === 'done' && subtasks > 0)
      env.toast.show({ message: `Done '${t.task.title}'${andSubtasks(subtasks)}` })
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'needs_confirmation') {
      const openCount = Number(e.details?.openCount ?? 0)
      ui.set({ confirm: { id: t.id, status: want, openCount, until: env.now() + CONFIRM_MS } })
      return
    }
    throw e
  }
}

/** What the detail panel's status segments ask for. */
export type DetailStatus = 'open' | 'doing' | 'worked' | 'done' | 'cancelled'

/**
 * The detail panel's Status segments, on the same paths as the keys: Done and Cancelled are Space
 * and X (with the second press on a parent), Doing and Worked on are S and W, and Open reopens a
 * closed task or clears the mark of an open one.
 */
export async function setDetailStatus(
  env: CommandEnv,
  task: Task,
  want: DetailStatus,
  mark: Mark | null,
): Promise<void> {
  const t: Target = { id: task.id, task }
  if (want === 'done' || want === 'cancelled') return toggleClosed(env, t, want)
  if (env.ui.confirm) env.ui.set({ confirm: null })
  if (want === 'open') {
    if (task.status !== 'open') return toggleClosed(env, t, task.status)
    if (mark === null) return
    await recorded(
      env.mutate,
      {
        label: `Cleared ${mark === 'doing' ? 'Doing' : 'Worked on'} on ${quoted(task)}`,
        revert: () => env.api.send('POST', taskPath(task.id, '/mark'), { mark }),
        select: { pane: env.ui.pane, id: task.id },
      },
      () => env.api.send('POST', taskPath(task.id, '/mark'), { mark: null }),
    )
    return
  }
  return markTask(env, task, want)
}

/** S and W: core toggles a mark that is already set and keeps only one Doing. Closed tasks have no marks. */
async function markTask(env: CommandEnv, task: Task, mark: 'doing' | 'worked'): Promise<void> {
  if (task.status !== 'open') return
  const before = markOf(env, task.id)
  // Doing demotes the task that was Doing to Worked on; undo makes it Doing again.
  const demoted = mark === 'doing' && before !== 'doing' ? doingTaskId(env, task.id) : undefined
  const spot = daySpotOf(env, task)
  const label =
    before === mark
      ? `Cleared ${mark === 'doing' ? 'Doing' : 'Worked on'} on ${quoted(task)}`
      : `Marked ${quoted(task)} ${mark === 'doing' ? 'Doing' : 'Worked on'}`
  await recorded(
    env.mutate,
    {
      label,
      revert: async () => {
        await env.api.send('POST', taskPath(task.id, '/mark'), { mark: before })
        if (demoted) await env.api.send('POST', taskPath(demoted, '/mark'), { mark: 'doing' })
        // A mark schedules the task today; put it back on the day it had.
        if (spot.date !== env.today) await putBackOnDay(env, task.id, spot)
      },
      select: { pane: env.ui.pane, id: task.id },
    },
    () => env.api.send('POST', taskPath(task.id, '/mark'), { mark }),
  )
}

/** Today's mark on a task, from My Day or the tree. */
function markOf(env: CommandEnv, id: string): Mark | null {
  const item = env.dayItems.find((i) => i.task.id === id)
  if (item) return item.mark
  return env.rows.find((r) => r.id === id)?.node.mark ?? null
}

/** The task that is Doing today, other than `except`. */
function doingTaskId(env: CommandEnv, except: string): string | undefined {
  return (
    env.dayItems.find((i) => i.mark === 'doing' && i.task.id !== except)?.task.id ??
    env.rows.find((r) => r.node.mark === 'doing' && r.id !== except)?.id
  )
}

/** Deletes the task and its subtree and shows the undo toast. The caller has already moved the selection. */
async function deleteWithToast(env: CommandEnv, t: Target): Promise<void> {
  // Where the task was listed, so undo reselects it only in a pane it comes back to.
  const listed: Record<Pane, boolean> = {
    tree: treeRows(env).some((r) => r.id === t.id),
    day: env.dayItems.some((i) => i.task.id === t.id),
  }
  const pane = env.ui.pane
  if (env.ui.detailId === t.id) env.ui.set({ detailId: null })
  const res = await recorded(
    env.mutate,
    {
      label: `Deleted ${quoted(t.task)}`,
      revert: () => env.api.send('POST', taskPath(t.id, '/restore')),
      ...(listed[pane] && { select: { pane, id: t.id } }),
    },
    () => env.api.send<{ deletedIds: string[] }>('DELETE', taskPath(t.id)),
  )
  env.toast.show({
    message: `Deleted '${t.task.title}'${andSubtasks(Math.max(0, res.deletedIds.length - 1))}`,
    undoId: lastUndoId(),
  })
}

/** Mod+↑↓ and Tab / Shift+Tab in the tree, recorded for undo. */
function nudge(
  env: CommandEnv,
  t: Target,
  direction: 'up' | 'down' | 'indent' | 'outdent',
): Promise<unknown> {
  return recordMove(env, t.id, t.task.title, () =>
    env.api.send('POST', taskPath(t.id, '/nudge'), { direction }),
  )
}

// ---- Edit mode ----

type Editing = NonNullable<UiState['editing']>

const blank = (text: string) => text.trim() === ''

function openDraft(env: CommandEnv, draft: Draft, text = ''): void {
  env.ui.set({ draft, editing: { id: DRAFT_ID, initial: '', text }, treeSel: DRAFT_ID })
}

function editRow(env: CommandEnv, row: FlatRow): void {
  env.ui.set({
    draft: null,
    editing: { id: row.id, initial: row.node.title, text: row.node.title },
    treeSel: row.id,
  })
}

function leaveEdit(env: CommandEnv, selected: string | null): void {
  env.ui.set({ draft: null, editing: null, treeSel: selected })
}

/** Where the selection goes when a draft is dropped: the task it was opened after, else its parent. */
const draftAnchor = (d: Draft) => d.afterId ?? d.parentId ?? null

/**
 * PATCHes the title only if it changed. An emptied title reverts instead: the server rejects an
 * empty one, and Backspace is how a row is deleted. Returns the write, or null if nothing was sent.
 */
function saveTitle(env: CommandEnv, ed: Editing): Promise<unknown> | null {
  if (ed.id === DRAFT_ID || blank(ed.text) || ed.text === ed.initial) return null
  env.cache.update(ed.id, { title: ed.text })
  const { id, initial, text } = ed
  return recorded(
    env.mutate,
    {
      label: `Renamed '${initial}' to '${text}'`,
      revert: () => env.api.send('PATCH', taskPath(id), { title: initial }),
      select: { pane: env.ui.pane, id },
    },
    () => env.api.send('PATCH', taskPath(id), { title: text }),
  )
}

/**
 * Creates the draft's task, shown at once under a placeholder id that becomes the real id (in the
 * cache, the selection, editing and any later draft) as soon as the server answers. If the server
 * refuses, a toast says so, and writes queued after it that place a task after or under it use
 * the place it would have taken instead (R29).
 */
function createDraft(
  env: CommandEnv,
  d: Draft,
  title: string,
): { id: string; done: Promise<void> } {
  const id = pendingId()
  env.cache.insert({ ...blankNode(id, d.section, d.parentId), title }, d)
  undoHistory.push({
    label: `Added '${title}'`,
    // A refused create has nothing to undo: liveId skips the write (SkippedWrite).
    revert: () => env.api.send('DELETE', taskPath(id)),
    // Redo brings back the task undo deleted.
    reapply: () => env.api.send('POST', taskPath(id, '/restore')),
  })
  const done = env.mutate(async () => {
    // Resolved now, inside the queue: the anchor may be a task whose create was only just answered.
    const at = placementFor(d)
    const body: Record<string, unknown> = { title, section: at.section }
    if (at.parentId !== null) body.parentId = at.parentId
    if (at.afterId !== undefined) body.afterId = at.afterId
    if (at.beforeId !== undefined) body.beforeId = at.beforeId
    let task: Task
    try {
      task = await env.api.send<Task>('POST', '/api/tasks', body)
    } catch {
      failPendingId(id, at)
      env.cache.remove(id)
      env.ui.dropId(id, at)
      env.toast.show({ message: `Couldn't save '${title}'` })
      return
    }
    env.cache.created(id, task, title)
    settlePendingId(id, task.id)
    env.ui.replaceId(id, task.id)
  })
  return { id, done }
}

/** The row just above `rows[i]` at its depth and under the same parent, if any. */
function previousSibling(rows: FlatRow[], i: number): FlatRow | undefined {
  const { depth, section } = rows[i]!
  for (let j = i - 1; j >= 0; j--) {
    const r = rows[j]!
    if (r.depth < depth || r.section !== section) return undefined
    if (r.depth === depth) return r
  }
  return undefined
}

async function editDraft(cmd: Command, env: CommandEnv, d: Draft, text: string): Promise<void> {
  const { rows } = env
  const i = rows.findIndex((r) => r.isDraft)
  switch (cmd) {
    case 'edit.commitNew': {
      if (blank(text)) return leaveEdit(env, draftAnchor(d)) // Enter twice ends a list
      const created = createDraft(env, d, text)
      openDraft(env, { section: d.section, parentId: d.parentId, afterId: created.id })
      return created.done
    }
    case 'edit.exit': {
      if (blank(text)) return leaveEdit(env, draftAnchor(d))
      const created = createDraft(env, d, text)
      leaveEdit(env, created.id)
      return created.done
    }
    case 'edit.prev':
    case 'edit.next': {
      const next = rows[cmd === 'edit.prev' ? i - 1 : i + 1]
      if (i < 0 || !next) return
      const created = blank(text) ? null : createDraft(env, d, text)
      editRow(env, next)
      return created?.done
    }
    case 'edit.deleteEmpty': {
      const above = rows[i - 1]
      if (above) return editRow(env, above)
      return leaveEdit(env, rows[i + 1]?.id ?? null)
    }
    case 'indent': {
      // Inbox is flat. The draft becomes the last child of its previous sibling, expanded to show it.
      const prev = i < 0 || d.section === 'inbox' ? undefined : previousSibling(rows, i)
      if (!prev) return
      openDraft(env, { section: 'projects', parentId: prev.id }, text)
      if (!prev.node.collapsed) return
      env.cache.update(prev.id, { collapsed: false })
      await env.mutate(() => env.api.send('PATCH', taskPath(prev.id), { collapsed: false }))
      return
    }
    case 'outdent': {
      const parent = d.parentId === null ? undefined : rows.find((r) => r.id === d.parentId)
      if (!parent) return
      openDraft(env, { section: d.section, parentId: parent.parentId, afterId: parent.id }, text)
      return
    }
    default:
      return // Mod+↑↓ and anything else: a draft has nothing to move yet
  }
}

/**
 * My Day's editing: a title only, with no drafts. Enter and Esc save and leave; ↑↓, Mod+↑↓ and
 * Backspace on an empty title do nothing (the text field keeps any other key).
 */
async function editDayTask(cmd: Command, env: CommandEnv, ed: Editing): Promise<void> {
  if (cmd !== 'edit.commitNew' && cmd !== 'edit.exit') return
  const saved = saveTitle(env, ed)
  env.ui.set({ editing: null, daySel: ed.id })
  await saved
}

async function editTask(cmd: Command, env: CommandEnv, ed: Editing): Promise<void> {
  const { rows } = env
  const i = rows.findIndex((r) => r.id === ed.id)
  const row = rows[i]
  /** Saves, then keeps editing the same task, which the server is about to move. */
  const saveAndNudge = (direction: 'up' | 'down' | 'indent' | 'outdent') => {
    const saved = saveTitle(env, ed)
    if (saved) env.ui.set({ editing: { ...ed, initial: ed.text } })
    const nudged = row
      ? nudge(env, { id: row.id, task: row.node, row }, direction)
      : env.mutate(() => env.api.send('POST', taskPath(ed.id, '/nudge'), { direction }))
    return Promise.all([saved, nudged])
  }
  switch (cmd) {
    case 'edit.commitNew': {
      const saved = saveTitle(env, ed)
      if (row) openDraft(env, { section: row.section, parentId: row.parentId, afterId: row.id })
      else leaveEdit(env, ed.id)
      await saved
      return
    }
    case 'edit.exit': {
      const saved = saveTitle(env, ed)
      leaveEdit(env, ed.id)
      await saved
      return
    }
    case 'edit.prev':
    case 'edit.next': {
      const next = rows[cmd === 'edit.prev' ? i - 1 : i + 1]
      if (i < 0 || !next) return
      const saved = saveTitle(env, ed)
      editRow(env, next)
      await saved
      return
    }
    case 'edit.deleteEmpty': {
      if (!row || ed.text !== '') return
      const t: Target = { id: row.id, task: row.node, row }
      const above = rows[i - 1]
      if (above) editRow(env, above)
      else leaveEdit(env, neighbourAfterRemoval(env, t))
      return deleteWithToast(env, t)
    }
    case 'indent':
    case 'outdent':
      await saveAndNudge(cmd)
      return
    case 'move.up':
    case 'move.down':
      await saveAndNudge(cmd === 'move.up' ? 'up' : 'down')
      return
    default:
      return
  }
}

/** Runs a command: edit-mode ones while a title is being edited, navigate-mode ones otherwise. */
export async function runCommand(cmd: Command, env: CommandEnv): Promise<void> {
  const { ui, api, mutate } = env
  // Any command other than Space/X dismisses the "Press Space again" note.
  if (ui.confirm && cmd !== 'status.done' && cmd !== 'status.cancel') ui.set({ confirm: null })

  if (ui.editing) {
    if (ui.pane === 'day') return editDayTask(cmd, env, ui.editing)
    if (ui.editing.id !== DRAFT_ID) return editTask(cmd, env, ui.editing)
    if (ui.draft) return editDraft(cmd, env, ui.draft, ui.editing.text)
    return leaveEdit(env, null) // editing a draft that is gone: nothing to save
  }

  switch (cmd) {
    case 'nav.up':
    case 'nav.down':
    case 'nav.first':
    case 'nav.last':
      return navigate(env, cmd)
    case 'pane.toggle': {
      // The detail panel stands where My Day is: M closes it and shows My Day.
      const pane = ui.detailId !== null || ui.pane === 'tree' ? 'day' : 'tree'
      const patch: Partial<UiState> = { pane }
      if (ui.detailId !== null) patch.detailId = null
      // A pane whose selection is empty or no longer listed starts on its first row (none if it is empty).
      const sel = pane === 'tree' ? ui.treeSel : ui.daySel
      const ids = paneIdsFor(env, pane)
      if ((sel === null || !ids.includes(sel)) && ids[0] !== undefined)
        patch[pane === 'tree' ? 'treeSel' : 'daySel'] = ids[0]
      return ui.set(patch)
    }
    case 'detail.open':
      // The panel is already open on a task: a second Ctrl+O edits its notes. The panel can show a task the
      // tree selection is not on (opened from My Day, hidden under a collapsed parent), so that case counts too.
      if (
        ui.detailId !== null &&
        ui.pane === 'tree' &&
        (ui.treeSel === ui.detailId || !treeRows(env).some((r) => r.id === ui.detailId))
      ) {
        return ui.set({ notesNonce: ui.notesNonce + 1 })
      }
      break
    case 'escape':
      if (ui.detailId !== null) return ui.set({ detailId: null })
      return select(env, null)
    case 'undo':
      return undo(env)
    case 'redo':
      return redo(env)
    case 'nav.upLevel':
    case 'nav.downLevel':
      return navigateLevel(env, cmd === 'nav.upLevel' ? 'up' : 'down')
    case 'new.inbox':
      // I: a new task at the end of Inbox, from anywhere, so an empty Inbox is always one key away.
      if (ui.detailId !== null) ui.set({ detailId: null })
      ui.set({ pane: 'tree' })
      return openDraft(env, { section: 'inbox', parentId: null })
    case 'new.below': {
      if (ui.pane === 'day') return ui.focusDayAdd()
      // After the selected task's subtree at its level; with no selection, at the end of Inbox.
      const row = target(env)?.row
      return openDraft(
        env,
        row
          ? { section: row.section, parentId: row.parentId, afterId: row.id }
          : { section: 'inbox', parentId: null },
      )
    }
    case 'edit.commitNew':
    case 'edit.prev':
    case 'edit.next':
    case 'edit.deleteEmpty':
    case 'edit.exit':
      return
  }

  const t = (ON_DETAIL.has(cmd) && detailTarget(env)) || target(env)
  if (!t) return
  const { row } = t

  switch (cmd) {
    case 'edit.start':
      if (row) return editRow(env, row)
      if (ui.pane === 'day')
        ui.set({ editing: { id: t.id, initial: t.task.title, text: t.task.title } })
      return
    case 'nav.parent':
      if (row?.parentId && treeRows(env).some((r) => r.id === row.parentId))
        select(env, row.parentId)
      return
    case 'nav.child': {
      const first = row?.hasChildren ? row.node.children[0] : undefined
      if (!row || !first) return
      const expanding = row.node.collapsed
        ? mutate(() => api.send('PATCH', taskPath(t.id), { collapsed: false }))
        : null
      select(env, first.id)
      await expanding
      return
    }
    case 'fold.collapse':
    case 'fold.expand': {
      const collapsed = cmd === 'fold.collapse'
      if (!row?.hasChildren || row.node.collapsed === collapsed) return
      await mutate(() => api.send('PATCH', taskPath(t.id), { collapsed }))
      return
    }
    case 'move.up':
    case 'move.down': {
      const direction = cmd === 'move.up' ? 'up' : 'down'
      if (ui.pane === 'day') return moveInDay(env, t.task, direction)
      await nudge(env, t, direction)
      return
    }
    case 'indent':
    case 'outdent':
      if (ui.pane !== 'tree') return
      await nudge(env, t, cmd)
      return
    case 'schedule.today':
      if (t.task.scheduledOn === env.today) return
      await recordSchedule(env, t.task, `Scheduled ${quoted(t.task)} for today`, () =>
        api.send('POST', taskPath(t.id, '/schedule'), { date: env.today }),
      )
      return
    case 'schedule.pick':
      // Not from the tree's day-less My Day: B already takes a task off today there.
      return ui.set({ picker: { taskId: t.id, allowNoDay: ui.pane === 'tree' } })
    case 'schedule.backlog':
      if (t.task.scheduledOn === null) return
      if (ui.pane === 'day') {
        select(env, neighbourAfterRemoval(env, t))
        await removeFromDay(env, t.task)
        return
      }
      await recordSchedule(env, t.task, `Took ${quoted(t.task)} off its day`, () =>
        api.send('POST', taskPath(t.id, '/schedule'), { date: null }),
      )
      return
    case 'mark.doing':
    case 'mark.worked':
      return markTask(env, t.task, cmd === 'mark.doing' ? 'doing' : 'worked')
    case 'status.done':
      return toggleClosed(env, t, 'done')
    case 'status.cancel':
      return toggleClosed(env, t, 'cancelled')
    case 'delete':
      // In My Day, Del takes the task off today; the task itself stays (Shift+Del deletes it).
      if (env.ui.pane === 'day') {
        if (t.task.scheduledOn === null) return
        select(env, neighbourAfterRemoval(env, t))
        await removeFromDay(env, t.task)
        return
      }
      // A task the tree does not list (hidden under a collapsed parent) leaves the selection alone.
      if (row) select(env, neighbourAfterRemoval(env, t))
      return deleteWithToast(env, t)
    case 'delete.task':
      if (env.ui.pane === 'day' || row) select(env, neighbourAfterRemoval(env, t))
      return deleteWithToast(env, t)
    case 'detail.open':
      // The detail replaces My Day, so from there the task is selected in the tree. Hidden under a
      // collapsed parent, the detail still shows it and the tree selection stays where it is.
      if (ui.pane === 'day')
        return ui.set({
          detailId: t.id,
          pane: 'tree',
          ...(treeRows(env).some((r) => r.id === t.id) && { treeSel: t.id }),
        })
      return ui.set({ detailId: t.id })
    case 'link.open':
      if (!t.task.link?.trim()) return
      await mutate(() => api.send('POST', taskPath(t.id, '/open-link')))
      return
  }
}
