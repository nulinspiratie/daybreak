import type { DayItem, TreeNode, TreeView } from '@daybreak/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type api } from '../src/api/client'
import { createMutationQueue } from '../src/api/queue'
import { type CommandEnv, confirmNoteText, runCommand } from '../src/keyboard/commands'
import { TOAST_MS, toast, toastText, useToastStore } from '../src/shell/toastStore'
import { flatten } from '../src/tree/flatten'
import { useUi } from '../src/ui/store'
import { node } from './helpers'

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

type Call = [method: string, path: string, body?: unknown]
let calls: Call[]
let clock: number
let reply: (method: string, path: string, body?: unknown) => unknown
const queue = () => createMutationQueue()
let q = queue()

const fakeApi = {
  get: vi.fn(async (path: string) => {
    calls.push(['GET', path])
    return reply('GET', path)
  }),
  send: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body])
    return reply(method, path, body)
  }),
} as unknown as typeof api

function env(over: Partial<CommandEnv> = {}): CommandEnv {
  return {
    rows: flatten(view()),
    dayItems: DAY,
    ui: useUi.getState(),
    api: fakeApi,
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
  calls = []
  clock = 1_000_000
  q = queue()
  reply = () => undefined
  ui().set({ pane: 'tree', treeSel: null, daySel: null, confirm: null, detailId: null, editing: null, draft: null })
  toast.dismiss()
})

describe('closing a parent: the double-press rule', () => {
  beforeEach(() => {
    reply = (method, _path, body) => {
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
    reply = (_m, _p, body) => {
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
    expect(toastText(toast.current()!)).toBe("Cancelled 'Milestone 2' and 1 subtask")
  })

  it('a leaf closes at once with a plain toast; a done or cancelled task reopens on Space or X', async () => {
    reply = () => ({ task: node('c1'), changedIds: ['c1'] })
    select('c1')
    await run('status.done')
    expect(calls).toEqual([['PATCH', '/api/tasks/c1', { status: 'done' }]])
    expect(toastText(toast.current()!)).toBe("Done 'c1'")

    toast.dismiss()
    const rows = flatten(view())
    const done = rows.map((r) => (r.id === 'c1' ? { ...r, node: { ...r.node, status: 'done' as const } } : r))
    await run('status.done', { rows: done })
    await run('status.cancel', { rows: done })
    const cancelled = rows.map((r) => (r.id === 'c1' ? { ...r, node: { ...r.node, status: 'cancelled' as const } } : r))
    await run('status.done', { rows: cancelled })
    expect(calls.slice(1)).toEqual([
      ['PATCH', '/api/tasks/c1', { status: 'open' }],
      ['PATCH', '/api/tasks/c1', { status: 'open' }],
      ['PATCH', '/api/tasks/c1', { status: 'open' }],
    ])
    expect(toast.current()).toBeNull()
  })
})

describe('delete and undo', () => {
  it('delete shows the toast "Deleted \'Port fit routines\' and 6 subtasks · Undo (Z)"', async () => {
    reply = (method) => (method === 'DELETE' ? { deletedIds: ['p1', 'm2', 'c1', 'c2', 'c3', 'c4', 'c5'] } : { restoredIds: [] })
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
    reply = () => ({ deletedIds: ['p3'] })
    select('p3')
    await run('delete')
    expect(toastText(toast.current()!)).toBe("Deleted 'p3' · Undo (Z)")
    expect(ui().treeSel).toBe('p2')
  })

  it('a newer delete replaces the toast and Z undoes the newest', async () => {
    reply = (_m, path) => ({ deletedIds: [path.split('/')[3]] })
    select('c5')
    await run('delete')
    select('p3')
    await run('delete')
    await run('toast.undo')
    expect(calls.at(-1)).toEqual(['POST', '/api/tasks/p3/restore', undefined])
  })

  it('toast.undo with no toast does nothing', async () => {
    await run('toast.undo')
    expect(calls).toEqual([])
  })
})

describe('moves', () => {
  it('move.down ×5 sends five nudges in order and selection stays on the task', async () => {
    let delay = 25
    reply = () => new Promise((r) => setTimeout(() => r(node('c2')), (delay -= 5)))
    select('c2')
    await Promise.all([1, 2, 3, 4, 5].map(() => run('move.down')))
    expect(calls).toEqual(Array(5).fill(['POST', '/api/tasks/c2/nudge', { direction: 'down' }]))
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
    reply = (method) => (method === 'GET' ? { items: DAY } : node('d2'))
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
    reply = () => ({ items: DAY })
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

  it('detail.open sets detailId; schedule.pick is a no-op until the day picker', async () => {
    select('c2')
    await run('detail.open')
    expect(ui().detailId).toBe('c2')
    await run('schedule.pick')
    expect(calls).toEqual([])
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

  it('edit-mode commands, edit.start and new.below are no-ops for now', async () => {
    select('c1')
    for (const cmd of ['edit.start', 'new.below', 'edit.commitNew', 'edit.prev', 'edit.next', 'edit.deleteEmpty', 'edit.exit'] as const) {
      await run(cmd)
    }
    expect(calls).toEqual([])
    expect(ui()).toMatchObject({ treeSel: 'c1', editing: null, draft: null })
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
