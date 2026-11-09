import type { DayItem, TreeNode, TreeView } from '@daybreak/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { createMutationQueue } from '../src/api/queue'
import {
  type CommandEnv,
  confirmNoteText,
  moveTo,
  runCommand,
  scheduleAt,
} from '../src/keyboard/commands'
import { TOAST_MS, toast, toastText, useToastStore } from '../src/shell/toastStore'
import { flatten } from '../src/tree/flatten'
import { pendingId, settlePendingId, type TreeCache } from '../src/tree/optimistic'
import { useUi } from '../src/ui/store'
import { undoHistory } from '../src/undo/history'
import { createFakeApi, node } from './helpers'

const TODAY = '2026-11-09'

// Inbox: i1. Projects: p1 'Port fit routines' (m2 'Milestone 2' [c1..c4], c5), p2 collapsed [k1, k2], p3.
const kids = (ids: string[]) => ids.map((id) => node(id))
function view(): TreeView {
  return {
    today: TODAY,
    inbox: [node('i1', [], { section: 'inbox', title: 'Inbox one' })],
    projects: [
      node(
        'p1',
        [node('m2', kids(['c1', 'c2', 'c3', 'c4']), { title: 'Milestone 2' }), node('c5')],
        {
          title: 'Port fit routines',
        },
      ),
      node('p2', kids(['k1', 'k2']), { collapsed: true }),
      node('p3', [], { link: 'C:\\work\\p3.txt' }),
    ],
    hiddenCompletedCount: 0,
  }
}
const dayItem = (n: TreeNode): DayItem => ({
  task: n,
  path: ['Inbox'],
  mark: null,
  doneCount: 0,
  totalCount: 0,
})
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
const noCache: TreeCache = {
  insert: () => {},
  update: () => {},
  created: () => {},
  remove: () => {},
  move: () => {},
  moveInDay: () => {},
}

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
const run = (cmd: Parameters<typeof runCommand>[0], over?: Partial<CommandEnv>) =>
  runCommand(cmd, env(over))
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
  ui().set({
    pane: 'tree',
    treeSel: null,
    daySel: null,
    confirm: null,
    detailId: null,
    editing: null,
    draft: null,
  })
  toast.dismiss()
  undoHistory.clear()
})

describe('closing a parent: the double-press rule', () => {
  beforeEach(() => {
    fake.reply = (method, _path, body) => {
      const b = body as { status?: string; withOpenDescendants?: boolean } | undefined
      if (method === 'PATCH' && b?.status === 'done' && !b.withOpenDescendants)
        throw needsConfirmation(4)
      return {
        task: node('m2', [], { status: 'done' }),
        changedIds: ['m2', 'c1', 'c2', 'c3', 'c4'],
      }
    }
    select('m2')
  })

  it('status.done on a parent first sets confirm and shows the note, second press within 4 s sends withOpenDescendants', async () => {
    await run('status.done')
    expect(calls).toEqual([['PATCH', '/api/tasks/m2', { status: 'done' }]])
    expect(ui().confirm).toEqual({ id: 'm2', status: 'done', openCount: 4, until: clock + 4000 })
    expect(confirmNoteText(ui().confirm!)).toBe(
      '4 open subtasks. Press Space again to close them all.',
    )
    expect(toast.current()).toBeNull()

    clock += 3999
    await run('status.done')
    expect(calls[1]).toEqual([
      'PATCH',
      '/api/tasks/m2',
      { status: 'done', withOpenDescendants: true },
    ])
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
    expect(
      calls.filter((c) => (c[2] as { withOpenDescendants?: boolean }).withOpenDescendants),
    ).toEqual([])
  })

  it('X uses the same rule with cancel wording', async () => {
    fake.reply = (_m, _p, body) => {
      if (!(body as { withOpenDescendants?: boolean }).withOpenDescendants)
        throw needsConfirmation(1)
      return { task: node('m2', [], { status: 'cancelled' }), changedIds: ['m2', 'c1'] }
    }
    await run('status.cancel')
    expect(confirmNoteText(ui().confirm!)).toBe('1 open subtask. Press X again to cancel them all.')
    // Space does not confirm an X note: it starts its own.
    await run('status.done')
    expect(ui().confirm?.status).toBe('done')
    await run('status.cancel')
    await run('status.cancel')
    expect(calls.at(-1)).toEqual([
      'PATCH',
      '/api/tasks/m2',
      { status: 'cancelled', withOpenDescendants: true },
    ])
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
    fake.reply = (method) =>
      method === 'DELETE' ? { deletedIds: ['p3'] } : { task: node('c1'), changedIds: ['c1'] }
    select('p3')
    await run('delete')
    select('c1')
    await run('status.done')
    expect(toast.current()?.message).toBe("Deleted 'p3'")
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
    fake.reply = (method) =>
      method === 'DELETE'
        ? { deletedIds: ['p1', 'm2', 'c1', 'c2', 'c3', 'c4', 'c5'] }
        : { restoredIds: [] }
    select('p1')
    await run('delete')
    expect(calls).toEqual([['DELETE', '/api/tasks/p1', undefined]])
    expect(toastText(toast.current()!)).toBe(
      "Deleted 'Port fit routines' and 6 subtasks · Undo (Z)",
    )
    expect(ui().treeSel).toBe('p2') // the next visible row after the subtree

    await run('undo')
    expect(calls[1]).toEqual(['POST', '/api/tasks/p1/restore', undefined])
    expect(toast.current()?.message).toBe("Undone: Deleted 'Port fit routines'")
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
    await run('undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/p3/restore', undefined])
  })

  it('undo selects the restored task only in a pane it belongs to', async () => {
    fake.reply = (method) =>
      method === 'DELETE' ? { deletedIds: ['c5'] } : { restoredIds: ['c5'] }
    ui().set({ daySel: 'd1' })
    select('c5')
    await run('delete')
    await run('pane.toggle') // to My Day, where c5 is not scheduled
    await run('undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/c5/restore', undefined])
    expect(ui()).toMatchObject({ pane: 'day', daySel: 'd1', treeSel: 'p2' })

    // A My Day item deleted from My Day is reselected there.
    fake.reply = (method) =>
      method === 'DELETE' ? { deletedIds: ['d2'] } : { restoredIds: ['d2'] }
    select('d2', 'day')
    await run('delete')
    expect(ui().daySel).toBe('d3')
    await run('undo')
    expect(ui().daySel).toBe('d2')
  })

  it('undo keeps the toast and the change when the restore fails, so Z can be tried again', async () => {
    fake.reply = (method) => {
      if (method === 'DELETE') return { deletedIds: ['p3'] }
      throw new ApiError(500, 'internal', 'boom')
    }
    select('p3')
    await run('delete')
    await expect(run('undo')).rejects.toThrow('boom')
    expect(toast.current()?.undoId).toBeDefined()
    expect(undoHistory.size()).toBe(1)
  })

  it('undo with nothing to undo sends nothing and says so', async () => {
    await run('undo')
    expect(calls).toEqual([])
    expect(toast.current()?.message).toBe('Nothing to undo')
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
      delay -= 5
      return new Promise((r) =>
        setTimeout(() => {
          log.push(`end ${k}`)
          r(node('c2'))
        }, delay),
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
    expect(calls.map((c) => c[2])).toEqual([
      { direction: 'up' },
      { direction: 'indent' },
      { direction: 'outdent' },
    ])
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
    expect(calls).toEqual([])
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

  it("pane.toggle keeps each pane's last selection", async () => {
    ui().set({ pane: 'tree', treeSel: 'c1', daySel: 'd2' })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'day', treeSel: 'c1', daySel: 'd2' })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'tree', treeSel: 'c1', daySel: 'd2' })
  })

  it('pane.toggle into a pane with no selection selects its first row; an empty pane selects nothing', async () => {
    ui().set({ pane: 'tree', treeSel: 'c1', daySel: null })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'day', daySel: DAY[0]!.task.id })
    ui().set({ pane: 'day', treeSel: null })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'tree', treeSel: flatten(view())[0]!.id })
    ui().set({ pane: 'tree', daySel: null })
    await run('pane.toggle', { dayItems: [] })
    expect(ui()).toMatchObject({ pane: 'day', daySel: null })
  })

  it("pane.toggle also selects the first row when the pane's selection is no longer listed", async () => {
    ui().set({ pane: 'tree', treeSel: 'c1', daySel: 'gone' })
    await run('pane.toggle')
    expect(ui()).toMatchObject({ pane: 'day', daySel: 'd1' })
  })

  it('detail.open from My Day on a task hidden under a collapsed parent, then again, targets that task', async () => {
    const kid = node('hk', [], { title: 'Hidden kid', scheduledOn: TODAY })
    const hidden = flatten({
      today: TODAY,
      inbox: [],
      projects: [node('hp', [kid], { title: 'Collapsed', collapsed: true })],
      hiddenCompletedCount: 0,
    })
    const day = [dayItem(kid)]
    ui().set({ pane: 'day', daySel: 'hk', treeSel: null, detailId: null })
    await run('detail.open', { rows: hidden, dayItems: day })
    expect(ui()).toMatchObject({ pane: 'tree', detailId: 'hk', treeSel: null })
    const nonce = ui().notesNonce
    await run('detail.open', { rows: hidden, dayItems: day })
    expect(ui()).toMatchObject({ detailId: 'hk', notesNonce: nonce + 1 })
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
    for (const cmd of [
      'status.done',
      'delete',
      'schedule.today',
      'mark.doing',
      'move.down',
      'indent',
    ] as const) {
      await run(cmd)
    }
    expect(calls).toEqual([])
  })
})

describe('toast store', () => {
  afterEach(() => vi.useRealTimers())

  it('lasts 8 s and a newer toast replaces the older one', () => {
    vi.useFakeTimers()
    toast.show({ message: 'one', undoId: 1 })
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
    await expect(
      moveTo(env(), 'p1', { parentId: 'c1', section: 'projects' }, true),
    ).rejects.toThrow(ApiError)
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
      [
        'POST',
        '/api/tasks/c5/move',
        { parentId: 'pp1111', section: 'projects', afterId: 'aa1111' },
      ],
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

describe('undo history (Z)', () => {
  const ok = () => ({ task: node('x'), changedIds: ['x'] })

  it('My Day: Del takes the task off today, not out of the tree, with an undo toast', async () => {
    fake.reply = ok
    select('d2', 'day')
    await run('delete')
    expect(calls).toEqual([['POST', '/api/tasks/d2/schedule', { date: null }]])
    expect(toastText(toast.current()!)).toBe("Removed 'Day two' from My Day · Undo (Z)")
    expect(ui().daySel).toBe('d3')

    // Z puts it back where it was: after d1.
    await run('undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/d2/schedule', { date: TODAY, afterId: 'd1' }])
    expect(ui().daySel).toBe('d2')
    expect(toast.current()?.message).toBe("Undone: Removed 'Day two' from My Day")
  })

  it('My Day: Shift+Del deletes the task itself', async () => {
    fake.reply = () => ({ deletedIds: ['d1'] })
    select('d1', 'day')
    await run('delete.task')
    expect(calls).toEqual([['DELETE', '/api/tasks/d1', undefined]])
  })

  it('Z undoes T: the task goes back to having no day', async () => {
    fake.reply = ok
    select('c5')
    await run('schedule.today')
    await run('undo')
    expect(calls).toEqual([
      ['POST', '/api/tasks/c5/schedule', { date: TODAY }],
      ['POST', '/api/tasks/c5/schedule', { date: null }],
    ])
  })

  it('Z keeps undoing, newest first', async () => {
    fake.reply = ok
    select('c5')
    await run('schedule.today')
    await run('mark.worked')
    select('p3')
    await run('move.up')
    await run('undo')
    await run('undo')
    await run('undo')
    expect(calls.slice(3)).toEqual([
      // The move: back after p2, its previous sibling.
      ['POST', '/api/tasks/p3/move', { parentId: null, section: 'projects', afterId: 'p2' }],
      // The mark: cleared again.
      ['POST', '/api/tasks/c5/mark', { mark: null }],
      ['POST', '/api/tasks/c5/schedule', { date: null }],
      ['POST', '/api/tasks/c5/schedule', { date: null }],
    ])
    expect(undoHistory.size()).toBe(0)
  })

  it('Z undoes indent with the task back under its old parent, after its old sibling', async () => {
    fake.reply = ok
    select('c5')
    await run('indent')
    await run('undo')
    expect(calls.at(-1)).toEqual([
      'POST',
      '/api/tasks/c5/move',
      { parentId: 'p1', section: 'projects', afterId: 'm2' },
    ])
  })

  it('a move whose old neighbour has gone goes back to the old parent without one', async () => {
    fake.reply = (_method, path, body) => {
      if (path.endsWith('/move') && (body as { afterId?: string }).afterId)
        throw new ApiError(400, 'invalid', 'gone')
      return ok()
    }
    select('c5')
    await run('outdent')
    await run('undo')
    expect(calls.slice(-2)).toEqual([
      ['POST', '/api/tasks/c5/move', { parentId: 'p1', section: 'projects', afterId: 'm2' }],
      ['POST', '/api/tasks/c5/move', { parentId: 'p1', section: 'projects' }],
    ])
  })

  it('Z undoes Space (reopens) and the reopen of a closed task (closes again)', async () => {
    fake.reply = ok
    select('c1')
    await run('status.done')
    await run('undo')
    expect(calls.at(-1)).toEqual(['PATCH', '/api/tasks/c1', { status: 'open' }])

    const done = flatten(view()).map((r) =>
      r.id === 'c1' ? { ...r, node: { ...r.node, status: 'done' as const } } : r,
    )
    await run('status.done', { rows: done })
    await run('undo')
    expect(calls.at(-1)).toEqual(['PATCH', '/api/tasks/c1', { status: 'done' }])
  })

  it('S demotes the Doing task; Z clears the new mark and makes the old one Doing again', async () => {
    fake.reply = ok
    const items = DAY.map((i) => (i.task.id === 'd1' ? { ...i, mark: 'doing' as const } : i))
    select('d2', 'day')
    await run('mark.doing', { dayItems: items })
    await run('undo', { dayItems: items })
    expect(calls).toEqual([
      ['POST', '/api/tasks/d2/mark', { mark: 'doing' }],
      ['POST', '/api/tasks/d2/mark', { mark: null }],
      ['POST', '/api/tasks/d1/mark', { mark: 'doing' }],
    ])
  })

  it('a refused change leaves nothing to undo', async () => {
    fake.reply = () => {
      throw new ApiError(400, 'invalid', 'no')
    }
    select('c5')
    await expect(run('schedule.today')).rejects.toThrow('no')
    expect(undoHistory.size()).toBe(0)
  })

  it('a parent close that only asked for confirmation records nothing', async () => {
    fake.reply = () => {
      throw needsConfirmation(4)
    }
    select('m2')
    await run('status.done')
    expect(undoHistory.size()).toBe(0)
  })

  it('the toast Undo reverts its own change even after newer ones', async () => {
    fake.reply = (method) => (method === 'DELETE' ? { deletedIds: ['p3'] } : ok())
    select('p3')
    await run('delete')
    const undoId = toast.current()!.undoId!
    select('c5')
    await run('schedule.today')
    const { undo } = await import('../src/keyboard/commands')
    await undo(env(), undoId)
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/p3/restore', undefined])
    expect(undoHistory.size()).toBe(1) // T is still there for Z
  })

  it('a title change is undone back to the old title', async () => {
    fake.reply = ok
    ui().set({ editing: { id: 'p3', initial: 'p3', text: 'Renamed' }, treeSel: 'p3' })
    await run('edit.exit')
    await run('undo')
    expect(calls).toEqual([
      ['PATCH', '/api/tasks/p3', { title: 'Renamed' }],
      ['PATCH', '/api/tasks/p3', { title: 'p3' }],
    ])
  })
})

describe('I: new task in Inbox', () => {
  it('opens a draft at the end of Inbox whatever is selected, also from My Day', async () => {
    select('k1')
    await run('new.inbox')
    expect(ui().draft).toEqual({ section: 'inbox', parentId: null })
    expect(ui().editing?.id).toBe('draft')
    ui().set({ draft: null, editing: null })
    select('d1', 'day')
    await run('new.inbox')
    expect(ui()).toMatchObject({ pane: 'tree', draft: { section: 'inbox', parentId: null } })
  })
})

describe('redo', () => {
  const ok = () => ({ task: node('x'), changedIds: ['x'] })

  it('redo makes an undone change again; a new change clears what could be redone', async () => {
    fake.reply = ok
    select('c5')
    await run('schedule.today')
    await run('undo')
    await run('redo')
    expect(calls).toEqual([
      ['POST', '/api/tasks/c5/schedule', { date: TODAY }],
      ['POST', '/api/tasks/c5/schedule', { date: null }],
      ['POST', '/api/tasks/c5/schedule', { date: TODAY }],
    ])
    expect(toast.current()?.message).toBe("Redone: Scheduled 'c5' for today")
    // Redone, it can be undone again.
    await run('undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/c5/schedule', { date: null }])
    select('p3')
    await run('status.done')
    await run('redo')
    expect(toast.current()?.message).toBe('Nothing to redo')
  })

  it('a delete is redone by deleting again; a new task by restoring it', async () => {
    fake.reply = (method) => (method === 'DELETE' ? { deletedIds: ['p3'] } : ok())
    select('p3')
    await run('delete')
    await run('undo')
    await run('redo')
    expect(calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      'DELETE /api/tasks/p3',
      'POST /api/tasks/p3/restore',
      'DELETE /api/tasks/p3',
    ])
  })
})

describe('Ctrl+Shift+↑↓: skip over nested rows', () => {
  // Rows: i1 | p1 (m2 (c1..c4), c5), p2 (collapsed), p3
  it('up goes to the previous sibling, past its subtree, else to the parent', async () => {
    select('c5')
    await run('nav.upLevel')
    expect(ui().treeSel).toBe('m2')
    await run('nav.upLevel')
    expect(ui().treeSel).toBe('p1')
    await run('nav.upLevel')
    expect(ui().treeSel).toBe('i1') // the row above at the top level, across the sections
  })

  it('down goes to the next sibling, else the row after the parent’s subtree', async () => {
    select('m2')
    await run('nav.downLevel')
    expect(ui().treeSel).toBe('c5')
    await run('nav.downLevel')
    expect(ui().treeSel).toBe('p2')
    select('c4')
    await run('nav.downLevel')
    expect(ui().treeSel).toBe('c5')
    select('p3')
    await run('nav.downLevel')
    expect(ui().treeSel).toBe('p3') // nothing below: stays
  })

  it('in My Day it is plain ↑↓', async () => {
    select('d2', 'day')
    await run('nav.upLevel')
    expect(ui().daySel).toBe('d1')
  })
})
