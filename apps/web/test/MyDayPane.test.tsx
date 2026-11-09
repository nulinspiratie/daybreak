// @vitest-environment happy-dom
import type { DayItem, DayView, Mark, Task } from '@daybreak/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { queue, useDrainInvalidation } from '../src/api/hooks'
import { IS_MAC } from '../src/keyboard/platform'
import { useKeyboard } from '../src/keyboard/useKeyboard'
import { MyDayPane } from '../src/myday/MyDayPane'
import { ConfirmLive } from '../src/shell/ConfirmNote'
import { toast } from '../src/shell/toastStore'
import { resetPendingIds } from '../src/tree/optimistic'
import { TreePane } from '../src/tree/TreePane'
import { useUi } from '../src/ui/store'
import { type FakeApi, node } from './helpers'

const shared = vi.hoisted(() => ({ fake: null as FakeApi | null }))
vi.mock('../src/api/client', async (importOriginal) => {
  const { createFakeApi } = await import('./helpers')
  shared.fake = createFakeApi()
  return { ...(await importOriginal<typeof import('../src/api/client')>()), api: shared.fake.api }
})
const fake = () => shared.fake!

const TODAY = '2026-11-09'

function item(
  id: string,
  over: Partial<Task> = {},
  path: string[] = ['Inbox'],
  mark: Mark | null = null,
): DayItem {
  const {
    children: _c,
    mark: _m,
    doneCount: _d,
    totalCount: _t,
    ...task
  } = node(id, [], { scheduledOn: TODAY, title: `Title ${id}`, ...over })
  return { task: task as Task, path, mark, doneCount: 0, totalCount: 0 }
}

let items: DayItem[]
/** While set, PATCHes wait for it, so a test can look at the screen before the server answers. */
/** Also mount the tree, listing every day item in Inbox. */
let withTree = false
let gate: Promise<void> | null = null
// The counts as core gives them: cancelled items are left out of both.
const day = (): DayView => ({
  date: TODAY,
  items,
  doneCount: items.filter((i) => i.task.status === 'done').length,
  totalCount: items.filter((i) => i.task.status !== 'cancelled').length,
})

function Harness() {
  useDrainInvalidation()
  useKeyboard()
  return (
    <>
      <MyDayPane />
      {withTree && <TreePane />}
      <ConfirmLive />
    </>
  )
}

const ui = () => useUi.getState()
const writes = () => fake().calls.filter((c) => c[0] !== 'GET')
const MOD = IS_MAC ? { altKey: true } : { ctrlKey: true }
const addField = () => screen.getByRole('textbox', { name: 'Add to My Day' }) as HTMLInputElement

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
  })
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

async function start(rows: DayItem[], selected: string | null = null) {
  items = rows
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await screen.findByText('Monday 9 November')
  if (rows.length > 0) await screen.findByText(rows[0]!.task.title)
  else await screen.findByText(/Drag tasks in/)
  act(() => ui().set({ pane: 'day', daySel: selected }))
}

beforeEach(() => {
  gate = null
  withTree = false
  resetPendingIds()
  fake().calls.length = 0
  fake().reply = async (method, path) => {
    if (method === 'GET' && path === '/api/status')
      return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
    if (method === 'GET' && path.startsWith('/api/day/')) return day()
    if (method === 'GET' && path.startsWith('/api/tree')) {
      const inbox = withTree
        ? items.map((i) => node(i.task.id, [], { section: 'inbox', title: i.task.title }))
        : []
      return { today: TODAY, inbox, projects: [], hiddenCompletedCount: 0 }
    }
    if (method === 'POST' && path === '/api/tasks') return { id: 'new1' }
    if (method === 'PATCH' && gate) await gate
    return {}
  }
  useUi.getState().set({
    pane: 'tree',
    treeSel: null,
    daySel: null,
    editing: null,
    draft: null,
    confirm: null,
    detailId: null,
    dayAddNonce: 0,
  })
  toast.dismiss()
})
afterEach(async () => {
  await act(async () => {
    await queue.idle()
  })
  cleanup()
})

describe('header', () => {
  it('shows "2 of 5 done" with cancelled excluded, and the date', async () => {
    await start([
      item('a', { status: 'done' }),
      item('b', { status: 'done' }),
      item('c'),
      item('d'),
      item('e'),
      item('f', { status: 'cancelled' }),
    ])
    expect(screen.getByText('2 of 5 done')).toBeTruthy()
    expect(screen.getByText('Monday 9 November')).toBeTruthy()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('2')
    expect(bar.getAttribute('aria-valuemax')).toBe('5')
  })
})

describe('rows', () => {
  it('shows the empty state copy', async () => {
    await start([])
    expect(
      screen.getByText('Drag tasks in from the tree, or press T on a selected task'),
    ).toBeTruthy()
  })

  it('hides the empty state when there are items', async () => {
    await start([item('a')])
    expect(screen.queryByText(/Drag tasks in from the tree/)).toBeNull()
  })

  it('shows the path above the title: Inbox, or ancestors joined with " › "', async () => {
    await start([item('a', {}, ['Inbox']), item('b', {}, ['Roadmap', 'Milestone 2'])])
    expect(screen.getByText('Inbox')).toBeTruthy()
    expect(screen.getByText('Roadmap › Milestone 2')).toBeTruthy()
  })

  it('a Doing row has the doing class', async () => {
    await start([item('a', {}, ['Inbox'], 'doing'), item('b')])
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]!.className).toContain('row--doing')
    expect(rows[1]!.className).not.toContain('row--doing')
  })

  it('the Start action is offered on open rows only', async () => {
    await start([item('a'), item('b', { status: 'done' })])
    const [a, b] = screen.getAllByRole('listitem')
    expect(within(a!).getByRole('button', { name: /Start/ })).toBeTruthy()
    expect(within(b!).queryByRole('button', { name: /Start/ })).toBeNull()
  })

  it('clicking a row selects it and makes My Day the active pane', async () => {
    await start([item('a'), item('b')])
    act(() => ui().set({ pane: 'tree' }))
    fireEvent.click(screen.getByText('Title b'))
    expect(ui()).toMatchObject({ pane: 'day', daySel: 'b' })
    expect(screen.getAllByRole('listitem')[1]!.className).toContain('row--selected')
  })
})

describe('keys in the day pane', () => {
  it('Mod+ArrowUp on the second item posts schedule with beforeId of the first', async () => {
    await start([item('a'), item('b')], 'b')
    await press('ArrowUp', MOD)
    await flush()
    expect(writes()).toContainEqual([
      'POST',
      '/api/tasks/b/schedule',
      { date: TODAY, beforeId: 'a' },
    ])
  })

  it('ArrowDown moves the selection', async () => {
    await start([item('a'), item('b')], 'a')
    await press('ArrowDown')
    expect(ui().daySel).toBe('b')
  })

  it('Space on the selected row sends done', async () => {
    await start([item('a')], 'a')
    await press(' ')
    await flush()
    expect(writes()).toContainEqual(['PATCH', '/api/tasks/a', { status: 'done' }])
  })

  it('clicking the checkbox runs the same command, so a parent asks for a second press', async () => {
    fake().reply = async (method, path, body) => {
      if (method === 'GET' && path === '/api/status')
        return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
      if (method === 'GET' && path.startsWith('/api/day/')) return day()
      if (method === 'GET')
        return { today: TODAY, inbox: [], projects: [], hiddenCompletedCount: 0 }
      const b = body as { withOpenDescendants?: boolean } | undefined
      if (method === 'PATCH' && !b?.withOpenDescendants)
        throw new ApiError(409, 'needs_confirmation', 'x', { openCount: 2 })
      return { changedIds: ['a'] }
    }
    await start([item('a')])
    const box = screen.getByRole('button', { name: 'Tick off' })
    fireEvent.click(box)
    await flush()
    expect(ui().confirm).toMatchObject({ id: 'a', openCount: 2 })
    expect(document.querySelector('#confirm-note')?.textContent).toBe(
      '2 open subtasks. Press Space again to close them all.',
    )
    fireEvent.click(box)
    await flush()
    expect(writes().at(-1)).toEqual([
      'PATCH',
      '/api/tasks/a',
      { status: 'done', withOpenDescendants: true },
    ])
  })

  it('clicking Start marks the row Doing', async () => {
    await start([item('a')])
    fireEvent.click(screen.getByRole('button', { name: /Start/ }))
    await flush()
    expect(writes()).toContainEqual(['POST', '/api/tasks/a/mark', { mark: 'doing' }])
  })

  it('B takes the row off today', async () => {
    await start([item('a'), item('b')], 'a')
    await press('b')
    await flush()
    expect(writes()).toContainEqual(['POST', '/api/tasks/a/schedule', { date: null }])
    expect(ui().daySel).toBe('b')
  })
})

describe('add field', () => {
  it('adding "Order a spare SMA torque wrench" posts inbox + today and clears the field', async () => {
    await start([item('a')])
    const input = addField()
    input.focus()
    fireEvent.change(input, { target: { value: 'Order a spare SMA torque wrench' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await flush()
    expect(writes()).toEqual([
      [
        'POST',
        '/api/tasks',
        { title: 'Order a spare SMA torque wrench', section: 'inbox', scheduledOn: TODAY },
      ],
    ])
    expect(addField().value).toBe('')
    expect(document.activeElement).toBe(addField())
  })

  it('an empty or blank title does nothing', async () => {
    await start([item('a')])
    const input = addField()
    fireEvent.change(input, { target: { value: '   ' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await flush()
    expect(writes()).toEqual([])
  })

  it('N in the day pane focuses it, and Esc blurs it back to navigate mode', async () => {
    await start([item('a'), item('b')], 'a')
    await press('n')
    expect(document.activeElement).toBe(addField())
    await act(async () => {
      fireEvent.keyDown(addField(), { key: 'Escape' })
    })
    expect(document.activeElement).not.toBe(addField())
    expect(ui().pane).toBe('day')
    await press('ArrowDown')
    expect(ui().daySel).toBe('b')
  })

  it('a refused add shows the toast and puts the title back for a retry', async () => {
    fake().reply = async (method, path) => {
      if (method === 'POST' && path === '/api/tasks') throw new ApiError(400, 'invalid', 'nope')
      if (method === 'GET' && path === '/api/status')
        return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
      if (method === 'GET' && path.startsWith('/api/day/')) return day()
      if (method === 'GET')
        return { today: TODAY, inbox: [], projects: [], hiddenCompletedCount: 0 }
      return {}
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await start([item('a')])
    const input = addField()
    input.focus()
    fireEvent.change(input, { target: { value: 'Order a spare SMA torque wrench' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await flush()
    expect(toast.current()?.message).toBe("Couldn't save 'Order a spare SMA torque wrench'")
    expect(addField().value).toBe('Order a spare SMA torque wrench')
    err.mockRestore()
  })

  it('a refused add does not overwrite what was typed since', async () => {
    fake().reply = async (method, path) => {
      if (method === 'POST' && path === '/api/tasks') throw new ApiError(400, 'invalid', 'nope')
      if (method === 'GET' && path === '/api/status')
        return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
      if (method === 'GET' && path.startsWith('/api/day/')) return day()
      if (method === 'GET')
        return { today: TODAY, inbox: [], projects: [], hiddenCompletedCount: 0 }
      return {}
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await start([item('a')])
    const input = addField()
    input.focus()
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'second' } })
    await flush()
    expect(addField().value).toBe('second')
    err.mockRestore()
  })

  it('fast repeated adds are posted in the order typed', async () => {
    await start([item('a')])
    const input = addField()
    input.focus()
    for (const title of ['one', 'two', 'three']) {
      fireEvent.change(input, { target: { value: title } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    await flush()
    expect(writes().map((c) => (c[2] as { title: string }).title)).toEqual(['one', 'two', 'three'])
  })

  it('typing letters in it never runs commands', async () => {
    await start([item('a')], 'a')
    await press('n')
    await press('b')
    await press(' ')
    expect(writes()).toEqual([])
  })
})

describe('inline title edit', () => {
  const editor = () => screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement
  const type = (text: string) =>
    act(async () => {
      fireEvent.change(editor(), { target: { value: text } })
    })

  it('Enter opens the editor, Esc saves a changed title with one PATCH', async () => {
    await start([item('a'), item('b')], 'a')
    await press('Enter')
    expect(editor().value).toBe('Title a')
    expect(document.activeElement).toBe(editor())
    await type('Renamed')
    await press('Escape')
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/a', { title: 'Renamed' }]])
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    expect(ui().editing).toBeNull()
    expect(ui().daySel).toBe('a')
  })

  it('Enter saves and leaves edit mode without opening a new row', async () => {
    await start([item('a')], 'a')
    await press('F2')
    await type('Renamed')
    await press('Enter')
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/a', { title: 'Renamed' }]])
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    expect(ui().draft).toBeNull()
  })

  it('an unchanged title sends nothing', async () => {
    await start([item('a')], 'a')
    await press('Enter')
    await press('Escape')
    await flush()
    expect(writes()).toEqual([])
  })

  it('an empty title reverts and sends nothing', async () => {
    await start([item('a')], 'a')
    await press('Enter')
    await type('')
    await press('Escape')
    await flush()
    expect(writes()).toEqual([])
    expect(screen.getByText('Title a')).toBeTruthy()
  })

  it('shows the new title at once, before the server answers', async () => {
    let open = () => {}
    gate = new Promise((r) => {
      open = r
    })
    await start([item('a')], 'a')
    await press('Enter')
    await type('Renamed')
    await press('Escape')
    expect(screen.getByText('Renamed')).toBeTruthy()
    gate = null
    open()
  })

  it('blurring to another control saves', async () => {
    await start([item('a')], 'a')
    await press('Enter')
    await type('Renamed')
    await act(async () => {
      fireEvent.blur(editor(), { relatedTarget: addField() })
    })
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/a', { title: 'Renamed' }]])
    expect(ui().editing).toBeNull()
  })

  it('arrows, Mod+arrows and Backspace on an empty title do nothing but edit text', async () => {
    await start([item('a'), item('b')], 'a')
    await press('Enter')
    await type('')
    for (const [key, init] of [
      ['ArrowDown', {}],
      ['ArrowUp', {}],
      ['ArrowUp', MOD],
      ['ArrowDown', MOD],
      ['Backspace', {}],
    ] as const) {
      await press(key, init)
    }
    await flush()
    expect(writes()).toEqual([])
    expect(ui().editing).toMatchObject({ id: 'a' })
    expect(ui().daySel).toBe('a')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('Backspace on a non-empty title is left to the input', async () => {
    await start([item('a')], 'a')
    await press('Enter')
    await press('Backspace')
    expect(ui().editing).toMatchObject({ id: 'a' })
  })
})

describe('a task listed in both panes', () => {
  it('is edited only in the active pane, with one editor and focus kept', async () => {
    withTree = true
    await start([item('a')], 'a')
    await screen.findAllByText('Title a')
    await press('Enter')
    await flush()
    const editors = screen.getAllByRole('textbox', { name: 'Task title' })
    expect(editors).toHaveLength(1)
    expect(editors[0]!.closest('.dayrow')).not.toBeNull()
    expect(document.activeElement).toBe(editors[0])
    expect(ui().editing).toMatchObject({ id: 'a' })
  })
})

describe('the edited task leaves the list', () => {
  it('ends editing so keys go back to navigate mode', async () => {
    await start([item('a'), item('b')], 'a')
    await press('Enter')
    expect(ui().editing).toMatchObject({ id: 'a' })
    items = [items[1]!]
    await act(async () => {
      await queue.enqueue(async () => {})
    })
    await waitFor(() => expect(ui().editing).toBeNull())
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
  })
})
