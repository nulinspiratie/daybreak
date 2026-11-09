// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queue, useDrainInvalidation } from '../src/api/hooks'
import { useKeyboard } from '../src/keyboard/useKeyboard'
import { PickerHost } from '../src/picker/PickerHost'
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

beforeEach(async () => {
  fake().calls.length = 0
  fake().reply = (method, path) => {
    if (path === '/api/status') return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
    if (path.startsWith('/api/day/')) return { date: TODAY, items: [], doneCount: 0, totalCount: 0 }
    if (path.startsWith('/api/days')) return {}
    if (path.startsWith('/api/tree')) {
      return {
        today: TODAY,
        inbox: [node('a', [], { section: 'inbox', title: 'Task a', scheduledOn: '2026-11-12' })],
        projects: [],
        hiddenCompletedCount: 0,
      }
    }
    return method === 'POST' ? {} : undefined
  }
  useUi.getState().set({ pane: 'tree', treeSel: null, daySel: null, editing: null, picker: null })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  )
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
    await flush()
    expect(writes()).toEqual([['POST', '/api/tasks/a/schedule', { date: '2026-11-11' }]])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ui().picker).toBeNull()
    expect(ui().treeSel).toBe('a')
    expect(ui().pane).toBe('tree')
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
})
