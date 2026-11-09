// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { queue, useDrainInvalidation } from '../src/api/hooks'
import { useKeyboard } from '../src/keyboard/useKeyboard'
import { PickerHost } from '../src/picker/PickerHost'
import { QUICK_PICK_MS } from '../src/picker/DayPicker'
import { toast } from '../src/shell/toastStore'
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
/** What the tree holds: the picker's task 'a', or nothing. */
let hasTask = true
let dayFails = false
let qc: QueryClient
const dayItems = () =>
  hasTask
    ? [{ task: node('a', [], { title: 'Task a', scheduledOn: TODAY }), path: ['Inbox'], mark: null, doneCount: 0, totalCount: 0 }]
    : []

function Harness() {
  useDrainInvalidation()
  useKeyboard()
  return (
    <>
      <TreePane />
      <PickerHost />
    </>
  )
}

const ui = () => useUi.getState()
const writes = () => fake().calls.filter((c) => c[0] !== 'GET')
async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key })
  })
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    await queue.idle()
  })
}

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  hasTask = true
  dayFails = false
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fake().calls.length = 0
  fake().reply = (method, path) => {
    if (path === '/api/status') return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
    if (path.startsWith('/api/day/')) {
      if (dayFails) throw new Error('down')
      return { date: TODAY, items: dayItems(), doneCount: 0, totalCount: 1 }
    }
    if (path.startsWith('/api/days')) return {}
    if (path.startsWith('/api/tree')) {
      return {
        today: TODAY,
        inbox: !hasTask ? [] : [node('a', [], { section: 'inbox', title: 'Task a', scheduledOn: '2026-11-12' })],
        projects: [],
        hiddenCompletedCount: 0,
      }
    }
    return method === 'POST' ? {} : undefined
  }
  useUi.getState().set({ pane: 'tree', treeSel: null, daySel: null, editing: null, picker: null, pickerShown: false })
  mount()
  await screen.findByText('Task a')
  act(() => ui().set({ treeSel: 'a' }))
})
afterEach(async () => {
  await flush()
  cleanup()
})

describe('PickerHost', () => {
  it('D opens the picker on the selected task, focused, and 3 schedules today+2 and closes', async () => {
    await press('d')
    expect(screen.getByRole('dialog', { name: 'Schedule task' })).toBeTruthy()
    expect(screen.getByText('Task a', { selector: '.picker-host__title' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Day' }))
    await press('3')
    await act(async () => {
      await new Promise((r) => setTimeout(r, QUICK_PICK_MS + 50))
    })
    await flush()
    expect(writes()).toEqual([['POST', '/api/tasks/a/schedule', { date: '2026-11-11' }]])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ui().picker).toBeNull()
    expect(ui().treeSel).toBe('a')
    expect(ui().pane).toBe('tree')
  })

  it('a pick the server refuses is reported in a toast', async () => {
    const reply = fake().reply
    fake().reply = (method, path, body) => {
      if (method === 'POST') throw new ApiError(404, 'not_found', '#a not found')
      return reply(method, path, body)
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.dismiss()
    await press('d')
    await press('3')
    await press('Enter')
    await flush()
    expect(writes()).toEqual([['POST', '/api/tasks/a/schedule', { date: '2026-11-11' }]])
    expect(toast.current()?.message).toBe('#a not found')
    error.mockRestore()
  })

  it('does not run global commands while open (arrows move the picker, not the selection)', async () => {
    await press('d')
    await press('ArrowDown')
    expect(ui().treeSel).toBe('a')
    expect(writes()).toEqual([])
  })

  it('starts the highlight on the task\'s own day and picking it again writes nothing', async () => {
    await press('d')
    await press('Enter')
    await flush()
    expect(writes()).toEqual([])
    expect(ui().picker).toBeNull()
  })

  it('No day clears the day; Esc closes without writing', async () => {
    await press('d')
    fireEvent.click(screen.getByRole('button', { name: 'No day' }))
    await flush()
    expect(writes()).toEqual([['POST', '/api/tasks/a/schedule', { date: null }]])
    await press('d')
    await press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes()).toHaveLength(1)
    expect(ui().treeSel).toBe('a')
  })

  it('the hover D button opens the picker for its row', async () => {
    act(() => ui().set({ treeSel: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick a day (D)' }))
    expect(ui().picker).toEqual({ taskId: 'a', allowNoDay: true })
    expect(ui().treeSel).toBe('a')
  })

  it('closes, with the pane and selection left alone, when the task is gone from the tree', async () => {
    hasTask = false
    act(() => ui().set({ picker: { taskId: 'a', allowNoDay: true } }))
    await flush()
    expect(ui().picker).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ui().treeSel).toBe('a')
    expect(ui().pickerShown).toBe(false)
  })

  it('closes when the task is missing and the day query failed too', async () => {
    cleanup()
    hasTask = false
    dayFails = true
    mount()
    await flush()
    act(() => ui().set({ picker: { taskId: 'a', allowNoDay: true } }))
    await flush()
    expect(ui().picker).toBeNull()
  })

  it('closes when the picked task is deleted while it is open', async () => {
    await press('d')
    expect(screen.getByRole('dialog')).toBeTruthy()
    hasTask = false
    await act(async () => {
      await qc.invalidateQueries()
    })
    await flush()
    expect(ui().picker).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('while the picker has not appeared, Esc closes it and other keys are not swallowed', async () => {
    act(() => ui().set({ picker: { taskId: 'zzz', allowNoDay: true }, pickerShown: false }))
    await press('ArrowDown') // not swallowed: selection moves (or stays on the only row)
    await press('Escape')
    expect(ui().picker).toBeNull()
  })

  it('from My Day the picker has no No day button', async () => {
    await flush()
    act(() => ui().set({ pane: 'day', daySel: 'a' }))
    await press('d')
    expect(ui().picker).toEqual({ taskId: 'a', allowNoDay: false })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'No day' })).toBeNull()
    await press('Escape')
    expect(ui().picker).toBeNull()
    expect(ui().daySel).toBe('a')
    expect(ui().pane).toBe('day')
  })
})
