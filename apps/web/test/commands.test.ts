import type { DayItem, TreeNode, TreeView } from '@daybreak/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { createMutationQueue } from '../src/api/queue'
import { type CommandEnv, confirmNoteText, moveTo, runCommand, scheduleAt } from '../src/keyboard/commands'
import { TOAST_MS, toast, toastText, useToastStore } from '../src/shell/toastStore'
import { flatten } from '../src/tree/flatten'
import { pendingId, settlePendingId, type TreeCache } from '../src/tree/optimistic'
import { useUi } from '../src/ui/store'
import { createFakeApi, node } from './helpers'

const TODAY = '2026-11-09'

// Inbox: i1. Projects: p1 'Port fit routines' (m2 'Milestone 2' [c1..c4], c5), p2 collapsed [k1, k2], p3.
const kids = (ids: string[]) => ids.map((id) => node(id))
function view(): TreeView {
  return {
    today: TODAY,
    inbox: [node('i1', [], { section: 'inbox', title: 'Inbox one' })],
    projects: [
      node('p1', [node('m2', kids(['c1', 'c2', 'c3', 'c4']), { title: 'Milestone 2' }), node('c5')], {
        title: 'Port fit routines',
      }),
      node('p2', kids(['k1', 'k2']), { collapsed: true }),
      node('p3', [], { link: 'C:\\work\\p3.txt' }),
    ],
    hiddenCompletedCount: 0,
  }
}
const dayItem = (n: TreeNode): DayItem => ({ task: n, path: ['Inbox'], mark: null, doneCount: 0, totalCount: 0 })
const DAY: DayItem[] = [
  dayItem(node('d1', [], { scheduledOn: TODAY, title: 'Day one' })),
  dayItem(node('d2', [], { scheduledOn: TODAY, title: 'Day two' })),
  dayItem(node('d3', [], { scheduledOn: TODAY, title: 'Day three' })),
]

let clock: number
const fake = createFakeApi()
const { calls } = fake
const queue = () => createMutationQueue()
let q = queue()
const noCache: TreeCache = { insert: () => {}, update: () => {}, created: () => {}, remove: () => {}, move: () => {}, moveInDay: () => {} }

function env(over: Partial<CommandEnv> = {}): CommandEnv {
  return {
    rows: flatten(view()),
    dayItems: DAY,
    ui: useUi.getState(),
    api: fake.api,
    cache: noCache,
    mutate: (fn) => q.enqueue(fn),
    today: TODAY,
    now: () => clock,
    toast,
    ...over,
  }
}
const run = (cmd: Parameters<typeof runCommand>[0], over?: Partial<CommandEnv>) => runCommand(cmd, env(over))
const ui = () => useUi.getState()
const select = (id: string | null, pane: 'tree' | 'day' = 'tree') =>
  ui().set(pane === 'tree' ? { pane, treeSel: id } : { pane, daySel: id })

const needsConfirmation = (openCount: number) =>
  new ApiError(409, 'needs_confirmation', `has ${openCount} open subtasks`, { openCount })

beforeEach(() => {
  calls.length = 0
  clock = 1_000_000
  q = queue()
  fake.reply = () => undefined
  ui().set({ pane: 'tree', treeSel: null, daySel: null, confirm: null, detailId: null, editing: null, draft: null })
  toast.dismiss()
})

describe('closing a parent: the double-press rule', () => {
  beforeEach(() => {
    fake.reply = (method, _path, body) => {
      const b = body as { status?: string; withOpenDescendants?: boolean } | undefined
      if (method === 'PATCH' && b?.status === 'done' && !b.withOpenDescendants) throw needsConfirmation(4)
      return { task: node('m2', [], { status: 'done' }), changedIds: ['m2', 'c1', 'c2', 'c3', 'c4'] }
    }
    select('m2')
  })

  it('status.done on a parent first sets confirm and shows the note, second press within 4 s sends withOpenDescendants', async () => {
    await run('status.done')
    expect(calls).toEqual([['PATCH', '/api/tasks/m2', { status: 'done' }]])
    expect(ui().confirm).toEqual({ id: 'm2', status: 'done', openCount: 4, until: clock + 4000 })
    expect(confirmNoteText(ui().confirm!)).toBe('4 open subtasks. Press Space again to close them all.')
    expect(toast.current()).toBeNull()

    clock += 3999
    await run('status.done')
    expect(calls[1]).toEqual(['PATCH', '/api/tasks/m2', { status: 'done', withOpenDescendants: true }])
    expect(ui().confirm).toBeNull()
    expect(toastText(toast.current()!)).toBe("Done 'Milestone 2' and 4 subtasks")
    expect(ui().treeSel).toBe('m2')
  })

  it('the second press after 4 s starts over', async () => {
    await run('status.done')
    clock += 4001
    await run('status.done')
    expect(calls).toEqual([
      ['PATCH', '/api/tasks/m2', { status: 'done' }],
      ['PATCH', '/api/tasks/m2', { status: 'done' }],
    ])
    expect(ui().confirm).toEqual({ id: 'm2', status: 'done', openCount: 4, until: clock + 4000 })
  })

  it('any other command clears confirm', async () => {
    await run('status.done')
    expect(ui().confirm).not.toBeNull()
    await run('nav.down')
    expect(ui().confirm).toBeNull()
    // …so the next Space starts over.
    select('m2')
    await run('status.done')
    expect(calls.filter((c) => (c[2] as { withOpenDescendants?: boolean }).withOpenDescendants)).toEqual([])
  })

  it('X uses the same rule with cancel wording', async () => {
    fake.reply = (_m, _p, body) => {
      if (!(body as { withOpenDescendants?: boolean }).withOpenDescendants) throw needsConfirmation(1)
      return { task: node('m2', [], { status: 'cancelled' }), changedIds: ['m2', 'c1'] }
    }
    await run('status.cancel')
    expect(confirmNoteText(ui().confirm!)).toBe('1 open subtask. Press X again to cancel them all.')
    // Space does not confirm an X note: it starts its own.
    await run('status.done')
    expect(ui().confirm?.status).toBe('done')
    await run('status.cancel')
    await run('status.cancel')
    expect(calls.at(-1)).toEqual(['PATCH', '/api/tasks/m2', { status: 'cancelled', withOpenDescendants: true }])
    // No Cancel toast: DESIGN only has the Done toast after a subtree close (R27).
    expect(toast.current()).toBeNull()
  })

  it('a confirm for one task does not confirm another: a press on a different task starts over', async () => {
    await run('status.done')
    select('p1')
    await run('status.done')
    expect(calls.map((c) => c[2])).toEqual([{ status: 'done' }, { status: 'done' }])
    expect(ui().confirm?.id).toBe('p1')
  })

  it('a leaf closes at once with no toast (R27)', async () => {
    fake.reply = () => ({ task: node('c1'), changedIds: ['c1'] })
    select('c1')
    await run('status.done')
    await run('status.cancel')
    expect(calls).toEqual([
      ['PATCH', '/api/tasks/c1', { status: 'done' }],
      ['PATCH', '/api/tasks/c1', { status: 'cancelled' }],
    ])
    expect(toast.current()).toBeNull()
  })

  it('a delete toast survives closing a task', async () => {
    fake.reply = (method) => (method === 'DELETE' ? { deletedIds: ['p3'] } : { task: node('c1'), changedIds: ['c1'] })
    select('p3')
    await run('delete')
    select('c1')
    await run('status.done')
    expect(toast.current()?.restoreId).toBe('p3')
  })

  it('R26: Space toggles done, X toggles cancelled; the other closed status is switched, not reopened', async () => {
    fake.reply = () => ({ task: node('c1'), changedIds: ['c1'] })
    select('c1')
    const withStatus = (status: 'done' | 'cancelled') =>
      flatten(view()).map((r) => (r.id === 'c1' ? { ...r, node: { ...r.node, status } } : r))
    await run('status.done', { rows: withStatus('done') })
    await run('status.cancel', { rows: withStatus('done') })
    await run('status.cancel', { rows: withStatus('cancelled') })
    await run('status.done', { rows: withStatus('cancelled') })
    expect(calls.map((c) => c[2])).toEqual([
      { status: 'open' },
      { status: 'cancelled' },
      { status: 'open' },
      { status: 'done' },
    ])
    expect(toast.current()).toBeNull()
  })
})

describe('delete and undo', () => {
  it('delete shows the toast "Deleted \'Port fit routines\' and 6 subtasks · Undo (Z)"', async () => {
    fake.reply = (method) => (method === 'DELETE' ? { deletedIds: ['p1', 'm2', 'c1', 'c2', 'c3', 'c4', 'c5'] } : { restoredIds: [] })
    select('p1')
    await run('delete')
    expect(calls).toEqual([['DELETE', '/api/tasks/p1', undefined]])
    expect(toastText(toast.current()!)).toBe("Deleted 'Port fit routines' and 6 subtasks · Undo (Z)")
    expect(ui().treeSel).toBe('p2') // the next visible row after the subtree

    await run('toast.undo')
    expect(calls[1]).toEqual(['POST', '/api/tasks/p1/restore', undefined])
    expect(toast.current()).toBeNull()
    expect(ui().treeSel).toBe('p1')
  })

  it('a leaf delete has no count; the last row selects the previous one', async () => {
    fake.reply = () => ({ deletedIds: ['p3'] })
    select('p3')
    await run('delete')
    expect(toastText(toast.current()!)).toBe("Deleted 'p3' · Undo (Z)")
    expect(ui().treeSel).toBe('p2')
  })

  it('a newer delete replaces the toast and Z undoes the newest', async () => {
    fake.reply = (_m, path) => ({ deletedIds: [path.split('/')[3]] })
    select('c5')
    await run('delete')
    select('p3')
    await run('delete')
    await run('toast.undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/p3/restore', undefined])
  })

  it('toast.undo selects the restored task only in a pane it belongs to', async () => {
    fake.reply = (method) => (method === 'DELETE' ? { deletedIds: ['c5'] } : { restoredIds: ['c5'] })
    ui().set({ daySel: 'd1' })
    select('c5')
    await run('delete')
    await run('pane.toggle') // to My Day, where c5 is not scheduled
    await run('toast.undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/c5/restore', undefined])
    expect(ui()).toMatchObject({ pane: 'day', daySel: 'd1', treeSel: 'p2' })

    // A My Day item deleted from My Day is reselected there.
    fake.reply = (method) => (method === 'DELETE' ? { deletedIds: ['d2'] } : { restoredIds: ['d2'] })
    select('d2', 'day')
    await run('delete')
    expect(ui().daySel).toBe('d3')
    await run('toast.undo')
    expect(ui().daySel).toBe('d2')
  })

  it('toast.undo keeps the toast when the restore fails, so Z can be tried again', async () => {
    fake.reply = (method) => {
      if (method === 'DELETE') return { deletedIds: ['p3'] }
      throw new ApiError(500, 'internal', 'boom')
    }
    select('p3')
    await run('delete')
    await expect(run('toast.undo')).rejects.toThrow('boom')
    expect(toast.current()?.restoreId).toBe('p3')
  })

  it('toast.undo with no toast does nothing', async () => {
    await run('toast.undo')
    expect(calls).toEqual([])
  })
})

describe('moves', () => {
  it('move.down ×5 sends five nudges in order and selection stays on the task', async () => {
    // Each nudge finishes before the next starts, although earlier ones take longer.
    const log: string[] = []
    let n = 0
    let delay = 25
    fake.reply = () => {
      const k = ++n
      log.push(`start ${k}`)
      return new Promise((r) =>
        setTimeout(() => {
          log.push(`end ${k}`)
          r(node('c2'))
        }, (delay -= 5)),
      )
    }
    select('c2')
    await Promise.all([1, 2, 3, 4, 5].map(() => run('move.down')))
    expect(calls).toEqual(Array(5).fill(['POST', '/api/tasks/c2/nudge', { direction: 'down' }]))
    expect(log).toEqual([1, 2, 3, 4, 5].flatMap((k) => [`start ${k}`, `end ${k}`]))
    expect(ui().treeSel).toBe('c2')
  })

  it('move.up, indent and outdent nudge the selected task', async () => {
    select('c5')
    await run('move.up')
    await run('indent')
    await run('outdent')
    expect(calls.map((c) => c[2])).toEqual([{ direction: 'up' }, { direction: 'indent' }, { direction: 'outdent' }])
    expect(ui().treeSel).toBe('c5')
  })

  it('My Day move reorders the day against a fresh day view', async () => {
    fake.reply = (method) => (method === 'GET' ? { items: DAY } : node('d2'))
    select('d2', 'day')
    await run('move.up')
    await run('move.down')
    expect(calls).toEqual([
      ['GET', `/api/day/${TODAY}`],
      ['POST', '/api/tasks/d2/schedule', { date: TODAY, beforeId: 'd1' }],
      ['GET', `/api/day/${TODAY}`],
      ['POST', '/api/tasks/d2/schedule', { date: TODAY, afterId: 'd3' }],
    ])
    expect(ui().daySel).toBe('d2')
  })

  it('moving the first My Day item up does nothing', async () => {
    fake.reply = () => ({ items: DAY })
    select('d1', 'day')
    await run('move.up')
    expect(calls).toEqual([['GET', `/api/day/${TODAY}`]])
  })
})

describe('navigation', () => {
  it('nav.up/down walk visible rows; with no selection they pick the first row', async () => {
    await run('nav.down')
    expect(ui().treeSel).toBe('i1')
    await run('nav.down')
    expect(ui().treeSel).toBe('p1')
    await run('nav.up')
    await run('nav.up')
    expect(ui().treeSel).toBe('i1')
    await run('nav.last')
    expect(ui().treeSel).toBe('p3')
    await run('nav.down')
    expect(ui().treeSel).toBe('p3')
    await run('nav.first')
    expect(ui().treeSel).toBe('i1')
  })

  it('nav.parent selects the parent', async () => {
    select('c3')
    await run('nav.parent')
    expect(ui().treeSel).toBe('m2')
  })

  it('nav.child on a collapsed parent expands it, then selects the first child', async () => {
    select('p2')
    await run('nav.child')
    expect(calls).toEqual([['PATCH', '/api/tasks/p2', { collapsed: false }]])
    expect(ui().treeSel).toBe('k1')
  })

  it('nav.child on an open parent just selects the first child; on a leaf it does nothing', async () => {
    select('m2')
    await run('nav.child')
    expect(ui().treeSel).toBe('c1')
    await run('nav.child')
    expect(ui().treeSel).toBe('c1')
    expect(calls).toEqual([])
  })

  it('fold.collapse and fold.expand patch collapsed only when it changes', async () => {
    select('m2')
    await run('fold.collapse')
    await run('fold.expand')
    select('p2')
    await run('fold.expand')
    await run('fold.collapse')
    expect(calls).toEqual([
      ['PATCH', '/api/tasks/m2', { collapsed: true }],
      ['PATCH', '/api/tasks/p2', { collapsed: false }],
    ])
  })

  it('pane.toggle keeps each pane\'s last selection', async () => {
    ui().set({ pane: 'tree', treeSel: 'c1', daySel: 'd2' })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'day', treeSel: 'c1', daySel: 'd2' })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'tree', treeSel: 'c1', daySel: 'd2' })
  })

  it('My Day navigation walks the day items', async () => {
    select(null, 'day')
    await run('nav.down')
    expect(ui().daySel).toBe('d1')
    await run('nav.last')
    expect(ui().daySel).toBe('d3')
    await run('nav.up')
    expect(ui().daySel).toBe('d2')
    expect(ui().treeSel).toBeNull()
  })

  it('escape closes the detail first, then clears the selection', async () => {
    ui().set({ treeSel: 'c1', detailId: 'c1' })
    await run('escape')
    expect(ui()).toMatchObject({ treeSel: 'c1', detailId: null })
    await run('escape')
    expect(ui().treeSel).toBeNull()
  })
})

describe('scheduling, marks, detail and link', () => {
  it('schedule.today in My Day on a task already today is a no-op', async () => {
    select('d1', 'day')
    await run('schedule.today')
    expect(calls).toEqual([])
  })

  it('schedule.backlog in My Day removes it from today', async () => {
    select('d2', 'day')
    await run('schedule.backlog')
    expect(calls).toEqual([['POST', '/api/tasks/d2/schedule', { date: null }]])
    expect(ui().daySel).toBe('d3')
  })

  it('schedule.today and schedule.backlog in the tree; backlog on an unscheduled task is a no-op', async () => {
    select('c1')
    await run('schedule.backlog')
    await run('schedule.today')
    const scheduled = flatten(view()).map((r) =>
      r.id === 'c1' ? { ...r, node: { ...r.node, scheduledOn: '2026-11-12' } } : r,
    )
    await run('schedule.backlog', { rows: scheduled })
    expect(calls).toEqual([
      ['POST', '/api/tasks/c1/schedule', { date: TODAY }],
      ['POST', '/api/tasks/c1/schedule', { date: null }],
    ])
    expect(ui().treeSel).toBe('c1')
  })

  it('mark.doing and mark.worked post the mark (core toggles and keeps one Doing)', async () => {
    select('c1')
    await run('mark.doing')
    await run('mark.worked')
    expect(calls).toEqual([
      ['POST', '/api/tasks/c1/mark', { mark: 'doing' }],
      ['POST', '/api/tasks/c1/mark', { mark: 'worked' }],
    ])
  })

  it('detail.open sets detailId', async () => {
    select('c2')
    await run('detail.open')
    expect(ui().detailId).toBe('c2')
  })

  it('detail.open from My Day moves to the tree and selects the task, unless the tree does not list it', async () => {
    ui().set({ treeSel: 'c1', daySel: 'c5', pane: 'day' })
    await run('detail.open', { dayItems: [dayItem(node('c5', [], { scheduledOn: TODAY }))] })
    expect(ui()).toMatchObject({ detailId: 'c5', pane: 'tree', treeSel: 'c5' })

    ui().set({ detailId: null, treeSel: 'c1', daySel: 'k1', pane: 'day' }) // k1 is under collapsed p2
    await run('detail.open', { dayItems: [dayItem(node('k1', [], { scheduledOn: TODAY }))] })
    expect(ui()).toMatchObject({ detailId: 'k1', pane: 'tree', treeSel: 'c1' })
  })

  it('M while the detail is open closes it and goes to My Day', async () => {
    ui().set({ pane: 'tree', treeSel: 'c1', detailId: 'c1' })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ detailId: null, pane: 'day' })
  })

  it('schedule.pick opens the picker for the selection: with No day from the tree, without it from My Day', async () => {
    select('c2')
    await run('schedule.pick')
    expect(ui().picker).toEqual({ taskId: 'c2', allowNoDay: true })
    useUi.getState().set({ picker: null })
    select('d1', 'day')
    await run('schedule.pick')
    expect(ui().picker).toEqual({ taskId: 'd1', allowNoDay: false })
    expect(calls).toEqual([])
    useUi.getState().set({ picker: null })
  })

  it('schedule.pick with nothing selected does nothing', async () => {
    select(null)
    await run('schedule.pick')
    expect(ui().picker).toBeNull()
  })

  it('link.open asks the server to open the link only when there is one', async () => {
    select('c1')
    await run('link.open')
    select('p3')
    await run('link.open')
    expect(calls).toEqual([['POST', '/api/tasks/p3/open-link', undefined]])
  })

  it('without a selection, task commands do nothing', async () => {
    for (const cmd of ['status.done', 'delete', 'schedule.today', 'mark.doing', 'move.down', 'indent'] as const) {
      await run(cmd)
    }
    expect(calls).toEqual([])
  })
})

describe('toast store', () => {
  afterEach(() => vi.useRealTimers())

  it('lasts 8 s and a newer toast replaces the older one', () => {
    vi.useFakeTimers()
    toast.show({ message: 'one', restoreId: 'a' })
    vi.advanceTimersByTime(5000)
    toast.show({ message: 'two' })
    expect(useToastStore.getState().toast?.message).toBe('two')
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(toast.current()?.message).toBe('two')
    vi.advanceTimersByTime(1)
    expect(toast.current()).toBeNull()
    expect(TOAST_MS).toBe(8000)
  })
})

describe('drag and drop writes', () => {
  it('moveTo sends the move, then opens a collapsed new parent when asked', async () => {
    await moveTo(env(), 'c5', { parentId: 'p2', section: 'projects', afterId: 'k2' }, true)
    await moveTo(env(), 'c5', { parentId: null, section: 'projects', beforeId: 'p1' })
    expect(calls).toEqual([
      ['POST', '/api/tasks/c5/move', { parentId: 'p2', section: 'projects', afterId: 'k2' }],
      ['PATCH', '/api/tasks/p2', { collapsed: false }],
      ['POST', '/api/tasks/c5/move', { parentId: null, section: 'projects', beforeId: 'p1' }],
    ])
  })

  it('a refused move does not open the parent', async () => {
    fake.reply = () => {
      throw new ApiError(400, 'invalid', 'A task cannot move under itself or its own descendant')
    }
    await expect(moveTo(env(), 'p1', { parentId: 'c1', section: 'projects' }, true)).rejects.toThrow(ApiError)
    expect(calls).toHaveLength(1)
  })

  it('anchors still shown under a placeholder are sent as their real ids', async () => {
    const parent = pendingId()
    const after = pendingId()
    settlePendingId(parent, 'pp1111')
    settlePendingId(after, 'aa1111')
    await moveTo(env(), 'c5', { parentId: parent, section: 'projects', afterId: after }, true)
    await scheduleAt(env(), 'c5', TODAY, { beforeId: after })
    expect(calls).toEqual([
      ['POST', '/api/tasks/c5/move', { parentId: 'pp1111', section: 'projects', afterId: 'aa1111' }],
      ['PATCH', '/api/tasks/pp1111', { collapsed: false }],
      ['POST', '/api/tasks/c5/schedule', { date: TODAY, beforeId: 'aa1111' }],
    ])
  })

  it('scheduleAt schedules on the day next to a neighbour', async () => {
    await scheduleAt(env(), 'c5', TODAY, { beforeId: 'd2' })
    await scheduleAt(env(), 'd3', TODAY, {})
    expect(calls).toEqual([
      ['POST', '/api/tasks/c5/schedule', { date: TODAY, beforeId: 'd2' }],
      ['POST', '/api/tasks/d3/schedule', { date: TODAY }],
    ])
  })
})
