import type { DayItem, DayView, ISODate, Mark, MoveTarget, Task } from '@daybreak/core'
import { ApiError, type api } from '../api/client'
import type { useMutate } from '../api/hooks'
import type { ToastApi } from '../shell/toastStore'
import { blankNode, DRAFT_ID, type FlatRow } from '../tree/flatten'
import { failPendingId, liveId, pendingId, placementFor, resolveId, settlePendingId, type TreeCache } from '../tree/optimistic'
import type { Draft, UiActions, UiState } from '../ui/store'
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

function paneIds(env: CommandEnv): string[] {
  return env.ui.pane === 'tree' ? treeRows(env).map((r) => r.id) : env.dayItems.map((i) => i.task.id)
}

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

function navigate(env: CommandEnv, cmd: 'nav.up' | 'nav.down' | 'nav.first' | 'nav.last'): void {
  const ids = paneIds(env)
  if (ids.length === 0) return
  const i = ids.indexOf(selectedId(env) ?? '')
  if (cmd === 'nav.first' || i < 0) return select(env, ids[0]!)
  if (cmd === 'nav.last') return select(env, ids[ids.length - 1]!)
  const j = cmd === 'nav.up' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1)
  select(env, ids[j]!)
}

/** The day picker's choice: schedule at the end of that day, or take the task off its day (null). Picking the current day does nothing, like T. */
export function pickDay(env: Pick<CommandEnv, 'api' | 'mutate'>, t: Task, date: ISODate | null): Promise<unknown> {
  if (t.scheduledOn === date) return Promise.resolve()
  return env.mutate(() => env.api.send('POST', taskPath(t.id, '/schedule'), { date }))
}

/** Drag and drop in the tree: the task and its subtree go to `to` (POST /move), then `expand` opens the new parent. */
export function moveTo(env: Pick<CommandEnv, 'api' | 'mutate'>, id: string, to: MoveTarget, expand = false): Promise<unknown> {
  return env.mutate(async () => {
    // Resolved now, inside the queue: an anchor may be a task whose create was only just answered.
    const { section, parentId, afterId, beforeId } = placementFor(to)
    const body: MoveTarget = { parentId, section, ...(afterId !== undefined && { afterId }), ...(beforeId !== undefined && { beforeId }) }
    await env.api.send('POST', taskPath(id, '/move'), body)
    if (expand && parentId !== null) await env.api.send('PATCH', taskPath(parentId), { collapsed: false })
  })
}

/** Drag and drop into My Day: schedule on `date` next to `at.afterId` or `at.beforeId` (at the end with neither). */
export function scheduleAt(
  env: Pick<CommandEnv, 'api' | 'mutate'>,
  id: string,
  date: ISODate,
  at: { afterId?: string; beforeId?: string },
): Promise<unknown> {
  return env.mutate(() => {
    const anchor = at.afterId !== undefined ? { afterId: resolveId(at.afterId) } : at.beforeId !== undefined ? { beforeId: resolveId(at.beforeId) } : {}
    return env.api.send('POST', taskPath(id, '/schedule'), { date, ...anchor })
  })
}

/** My Day: move one slot within today's order, read fresh inside the queue so quick presses stay correct. */
async function moveInDay(env: CommandEnv, id: string, dir: 'up' | 'down'): Promise<void> {
  await env.mutate(async () => {
    const day = await env.api.get<DayView>(`/api/day/${env.today}`)
    const ids = day.items.map((i) => i.task.id)
    const i = ids.indexOf(id)
    if (i < 0) return
    const at = dir === 'up' ? { beforeId: ids[i - 1] } : { afterId: ids[i + 1] }
    if (Object.values(at)[0] === undefined) return
    await env.api.send('POST', taskPath(id, '/schedule'), { date: env.today, ...at })
  })
}

/**
 * Space: done, or reopen if already done. X: cancel, or reopen if already cancelled (R26).
 * Closing an open parent needs a second press within 4 s (core answers 409 needs_confirmation).
 */
async function toggleClosed(env: CommandEnv, t: Target, want: Closed): Promise<void> {
  const { ui, api, mutate } = env
  if (t.task.status === want) {
    ui.set({ confirm: null })
    await mutate(() => api.send('PATCH', taskPath(t.id), { status: 'open' }))
    return
  }
  const c = ui.confirm
  const confirmed = c !== null && c.id === t.id && c.status === want && env.now() < c.until
  const body = confirmed ? { status: want, withOpenDescendants: true } : { status: want }
  try {
    const res = await mutate(() => api.send<{ changedIds: string[] }>('PATCH', taskPath(t.id), body))
    ui.set({ confirm: null })
    // DESIGN has one close toast: Done after closing a subtree (R27). No leaf or Cancel toasts.
    const subtasks = res.changedIds.length - 1
    if (want === 'done' && subtasks > 0) env.toast.show({ message: `Done '${t.task.title}'${andSubtasks(subtasks)}` })
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
export async function setDetailStatus(env: CommandEnv, task: Task, want: DetailStatus, mark: Mark | null): Promise<void> {
  const t: Target = { id: task.id, task }
  if (want === 'done' || want === 'cancelled') return toggleClosed(env, t, want)
  if (env.ui.confirm) env.ui.set({ confirm: null })
  if (want === 'open') {
    if (task.status !== 'open') return toggleClosed(env, t, task.status)
    if (mark === null) return
    await env.mutate(() => env.api.send('POST', taskPath(task.id, '/mark'), { mark: null }))
    return
  }
  return markTask(env, task, want)
}

/** S and W: core toggles a mark that is already set and keeps only one Doing. Closed tasks have no marks. */
async function markTask(env: CommandEnv, task: Task, mark: 'doing' | 'worked'): Promise<void> {
  if (task.status !== 'open') return
  await env.mutate(() => env.api.send('POST', taskPath(task.id, '/mark'), { mark }))
}

/** Deletes the task and its subtree and shows the undo toast. The caller has already moved the selection. */
async function deleteWithToast(env: CommandEnv, t: Target): Promise<void> {
  // Where the task was listed, so undo reselects it only in a pane it comes back to.
  const restoreIn: Pane[] = []
  if (treeRows(env).some((r) => r.id === t.id)) restoreIn.push('tree')
  if (env.dayItems.some((i) => i.task.id === t.id)) restoreIn.push('day')
  if (env.ui.detailId === t.id) env.ui.set({ detailId: null })
  const res = await env.mutate(() => env.api.send<{ deletedIds: string[] }>('DELETE', taskPath(t.id)))
  env.toast.show({
    message: `Deleted '${t.task.title}'${andSubtasks(Math.max(0, res.deletedIds.length - 1))}`,
    restoreId: t.id,
    restoreIn,
  })
}

// ---- Edit mode ----

type Editing = NonNullable<UiState['editing']>

const blank = (text: string) => text.trim() === ''

function openDraft(env: CommandEnv, draft: Draft): void {
  env.ui.set({ draft, editing: { id: DRAFT_ID, initial: '', text: '' }, treeSel: DRAFT_ID })
}

function editRow(env: CommandEnv, row: FlatRow): void {
  env.ui.set({ draft: null, editing: { id: row.id, initial: row.node.title, text: row.node.title }, treeSel: row.id })
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
  return env.mutate(() => env.api.send('PATCH', taskPath(ed.id), { title: ed.text }))
}

/**
 * Creates the draft's task, shown at once under a placeholder id that becomes the real id (in the
 * cache, the selection, editing and any later draft) as soon as the server answers. If the server
 * refuses, a toast says so, and writes queued after it that place a task after or under it use
 * the place it would have taken instead (R29).
 */
function createDraft(env: CommandEnv, d: Draft, title: string): { id: string; done: Promise<void> } {
  const id = pendingId()
  env.cache.insert({ ...blankNode(id, d.section, d.parentId), title }, d)
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
      openDraft(env, { section: 'projects', parentId: prev.id })
      if (!prev.node.collapsed) return
      env.cache.update(prev.id, { collapsed: false })
      await env.mutate(() => env.api.send('PATCH', taskPath(prev.id), { collapsed: false }))
      return
    }
    case 'outdent': {
      const parent = d.parentId === null ? undefined : rows.find((r) => r.id === d.parentId)
      if (!parent) return
      openDraft(env, { section: d.section, parentId: parent.parentId, afterId: parent.id })
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
    const nudged = env.mutate(() => env.api.send('POST', taskPath(ed.id, '/nudge'), { direction }))
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
    case 'pane.toggle':
      // The detail panel stands where My Day is: M closes it and shows My Day.
      if (ui.detailId !== null) return ui.set({ detailId: null, pane: 'day' })
      return ui.set({ pane: ui.pane === 'tree' ? 'day' : 'tree' })
    case 'escape':
      if (ui.detailId !== null) return ui.set({ detailId: null })
      return select(env, null)
    case 'toast.undo': {
      const shown = env.toast.current()
      if (!shown?.restoreId) return
      const id = shown.restoreId
      // Dismiss only once the restore worked, so a failed one can be retried with Z.
      await mutate(() => api.send('POST', taskPath(id, '/restore')))
      if (env.toast.current()?.id === shown.id) env.toast.dismiss()
      // A task deleted while its create was queued is named by its placeholder in the toast.
      if (shown.restoreIn?.includes(ui.pane)) select(env, resolveId(id))
      return
    }
    case 'new.below': {
      if (ui.pane === 'day') return ui.focusDayAdd()
      // After the selected task's subtree at its level; with no selection, at the end of Inbox.
      const row = target(env)?.row
      return openDraft(env, row ? { section: row.section, parentId: row.parentId, afterId: row.id } : { section: 'inbox', parentId: null })
    }
    case 'edit.commitNew':
    case 'edit.prev':
    case 'edit.next':
    case 'edit.deleteEmpty':
    case 'edit.exit':
      return
  }

  const t = target(env)
  if (!t) return
  const { row } = t

  switch (cmd) {
    case 'edit.start':
      if (row) return editRow(env, row)
      if (ui.pane === 'day') ui.set({ editing: { id: t.id, initial: t.task.title, text: t.task.title } })
      return
    case 'nav.parent':
      if (row?.parentId && treeRows(env).some((r) => r.id === row.parentId)) select(env, row.parentId)
      return
    case 'nav.child': {
      const first = row?.hasChildren ? row.node.children[0] : undefined
      if (!row || !first) return
      const expanding = row.node.collapsed ? mutate(() => api.send('PATCH', taskPath(t.id), { collapsed: false })) : null
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
      if (ui.pane === 'day') return moveInDay(env, t.id, direction)
      await mutate(() => api.send('POST', taskPath(t.id, '/nudge'), { direction }))
      return
    }
    case 'indent':
    case 'outdent':
      if (ui.pane !== 'tree') return
      await mutate(() => api.send('POST', taskPath(t.id, '/nudge'), { direction: cmd }))
      return
    case 'schedule.today':
      if (t.task.scheduledOn === env.today) return
      await mutate(() => api.send('POST', taskPath(t.id, '/schedule'), { date: env.today }))
      return
    case 'schedule.pick':
      // Not from the tree's day-less My Day: B already takes a task off today there.
      return ui.set({ picker: { taskId: t.id, allowNoDay: ui.pane === 'tree' } })
    case 'schedule.backlog':
      if (t.task.scheduledOn === null) return
      if (ui.pane === 'day') select(env, neighbourAfterRemoval(env, t))
      await mutate(() => api.send('POST', taskPath(t.id, '/schedule'), { date: null }))
      return
    case 'mark.doing':
    case 'mark.worked':
      return markTask(env, t.task, cmd === 'mark.doing' ? 'doing' : 'worked')
    case 'status.done':
      return toggleClosed(env, t, 'done')
    case 'status.cancel':
      return toggleClosed(env, t, 'cancelled')
    case 'delete':
      select(env, neighbourAfterRemoval(env, t))
      return deleteWithToast(env, t)
    case 'detail.open':
      // The detail replaces My Day, so from there the task is selected in the tree. Hidden under a
      // collapsed parent, the detail still shows it and the tree selection stays where it is.
      if (ui.pane === 'day') return ui.set({ detailId: t.id, pane: 'tree', ...(treeRows(env).some((r) => r.id === t.id) && { treeSel: t.id }) })
      return ui.set({ detailId: t.id })
    case 'link.open':
      if (!t.task.link?.trim()) return
      await mutate(() => api.send('POST', taskPath(t.id, '/open-link')))
      return
  }
}
