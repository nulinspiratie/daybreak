import type { DayItem, DayView, ISODate, Task } from '@daybreak/core'
import { ApiError, type api } from '../api/client'
import type { useMutate } from '../api/hooks'
import type { ToastApi } from '../shell/toastStore'
import type { FlatRow } from '../tree/flatten'
import type { UiActions, UiState } from '../ui/store'
import type { Command } from './keymap'

/** How long the "Press Space again" note waits for the second press. */
export const CONFIRM_MS = 4000

export interface CommandEnv {
  rows: FlatRow[]
  dayItems: DayItem[]
  /** A snapshot taken when the key was pressed; writes go through `ui.set`. */
  ui: UiState & UiActions
  api: typeof api
  mutate: ReturnType<typeof useMutate>
  today: ISODate
  now: () => number
  toast: ToastApi
}

type Confirm = NonNullable<UiState['confirm']>
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

// The draft row only exists in edit mode (Task 17); navigate-mode commands skip it.
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

const taskPath = (id: string, action = '') => `/api/tasks/${id}${action}`

function navigate(env: CommandEnv, cmd: 'nav.up' | 'nav.down' | 'nav.first' | 'nav.last'): void {
  const ids = paneIds(env)
  if (ids.length === 0) return
  const i = ids.indexOf(selectedId(env) ?? '')
  if (cmd === 'nav.first' || i < 0) return select(env, ids[0]!)
  if (cmd === 'nav.last') return select(env, ids[ids.length - 1]!)
  const j = cmd === 'nav.up' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1)
  select(env, ids[j]!)
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

async function closeOrReopen(env: CommandEnv, t: Target, want: Closed): Promise<void> {
  const { ui, api, mutate } = env
  if (t.task.status !== 'open') {
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
    const verb = want === 'done' ? 'Done' : 'Cancelled'
    env.toast.show({ message: `${verb} '${t.task.title}'${andSubtasks(Math.max(0, res.changedIds.length - 1))}` })
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'needs_confirmation') {
      const openCount = Number(e.details?.openCount ?? 0)
      ui.set({ confirm: { id: t.id, status: want, openCount, until: env.now() + CONFIRM_MS } })
      return
    }
    throw e
  }
}

/** Runs a navigate-mode command. Edit-mode commands, edit.start and new.below arrive with Task 17. */
export async function runCommand(cmd: Command, env: CommandEnv): Promise<void> {
  const { ui, api, mutate } = env
  // Any command other than Space/X dismisses the "Press Space again" note.
  if (ui.confirm && cmd !== 'status.done' && cmd !== 'status.cancel') ui.set({ confirm: null })

  switch (cmd) {
    case 'nav.up':
    case 'nav.down':
    case 'nav.first':
    case 'nav.last':
      return navigate(env, cmd)
    case 'pane.toggle':
      return ui.set({ pane: ui.pane === 'tree' ? 'day' : 'tree' })
    case 'escape':
      if (ui.detailId !== null) return ui.set({ detailId: null })
      return select(env, null)
    case 'toast.undo': {
      const shown = env.toast.current()
      if (!shown?.restoreId) return
      const id = shown.restoreId
      env.toast.dismiss()
      select(env, id)
      await mutate(() => api.send('POST', taskPath(id, '/restore')))
      return
    }
    case 'edit.start':
    case 'new.below':
    case 'edit.commitNew':
    case 'edit.prev':
    case 'edit.next':
    case 'edit.deleteEmpty':
    case 'edit.exit':
    case 'schedule.pick': // the day picker (Task 19) owns D
      return
  }

  const t = target(env)
  if (!t) return
  const { row } = t

  switch (cmd) {
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
    case 'schedule.backlog':
      if (t.task.scheduledOn === null) return
      if (ui.pane === 'day') select(env, neighbourAfterRemoval(env, t))
      await mutate(() => api.send('POST', taskPath(t.id, '/schedule'), { date: null }))
      return
    case 'mark.doing':
    case 'mark.worked':
      // Core toggles a mark that is already set and keeps only one Doing.
      if (t.task.status !== 'open') return
      await mutate(() => api.send('POST', taskPath(t.id, '/mark'), { mark: cmd === 'mark.doing' ? 'doing' : 'worked' }))
      return
    case 'status.done':
      return closeOrReopen(env, t, 'done')
    case 'status.cancel':
      return closeOrReopen(env, t, 'cancelled')
    case 'delete': {
      select(env, neighbourAfterRemoval(env, t))
      if (ui.detailId === t.id) ui.set({ detailId: null })
      const res = await mutate(() => api.send<{ deletedIds: string[] }>('DELETE', taskPath(t.id)))
      env.toast.show({
        message: `Deleted '${t.task.title}'${andSubtasks(Math.max(0, res.deletedIds.length - 1))}`,
        restoreId: t.id,
      })
      return
    }
    case 'detail.open':
      return ui.set({ detailId: t.id })
    case 'link.open':
      if (!t.task.link?.trim()) return
      await mutate(() => api.send('POST', taskPath(t.id, '/open-link')))
      return
  }
}
