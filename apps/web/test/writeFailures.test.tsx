// @vitest-environment happy-dom
import type { TreeView } from '@daybreak/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, Unreachable } from '../src/api/client'
import { queue, useDrainInvalidation } from '../src/api/hooks'
import { reportWriteError, useKeyboard } from '../src/keyboard/useKeyboard'
import { Toast } from '../src/shell/Toast'
import { toast } from '../src/shell/toastStore'
import { SkippedWrite } from '../src/tree/optimistic'
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
const RUNNING = "Couldn't save — is Daybreak running?"
/** The server's state: what a successful GET answers. */
let title: string
/** Every request fails as if the server had been closed. */
let down: boolean
/** What a write answers while the server is up. */
let onWrite: (method: string, path: string, body: unknown) => unknown

const tree = (): TreeView => ({
  today: TODAY,
  inbox: [node('a', [], { section: 'inbox', title })],
  projects: [],
  hiddenCompletedCount: 0,
})

function Harness() {
  useDrainInvalidation()
  useKeyboard()
  return (
    <>
      <TreePane />
      <Toast />
    </>
  )
}

const shown = () => toast.current()?.message
async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key })
  })
}
/** Waits for the queue to drain and the refetch it starts to land (or fail). */
async function settle() {
  await act(async () => {
    await queue.idle()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

let error: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  title = 'Task a'
  down = false
  onWrite = () => ({})
  toast.dismiss()
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  fake().calls.length = 0
  fake().reply = (method, path, body) => {
    if (down) throw new Unreachable(new TypeError('Failed to fetch'))
    if (method !== 'GET') return onWrite(method, path, body)
    if (path === '/api/status') return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
    if (path.startsWith('/api/tree')) return tree()
    if (path.startsWith('/api/day/')) return { date: TODAY, items: [], doneCount: 0, totalCount: 0 }
    return undefined
  }
  useUi.getState().set({
    pane: 'tree',
    treeSel: null,
    daySel: null,
    editing: null,
    draft: null,
    picker: null,
    pickerShown: false,
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  )
  await screen.findByText('Task a')
  act(() => useUi.getState().set({ treeSel: 'a' }))
})
afterEach(async () => {
  await settle()
  cleanup()
  error.mockRestore()
})

async function rename(to: string) {
  await press('Enter')
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: to } })
  })
  await press('Escape')
}

describe('a failed write', () => {
  it('with the server closed: a toast says so, and the edit is not left looking saved', async () => {
    down = true
    await rename('Renamed')
    await settle()
    expect(shown()).toBe(RUNNING)
    expect(screen.getByRole('status').textContent).toContain(RUNNING)
    // The refetch failed too; the tree is put back to what the server last said.
    expect(screen.queryByText('Renamed')).toBeNull()
    expect(screen.getByText('Task a')).toBeTruthy()
  })

  it('a key with nothing optimistic (T) is reported too, rather than doing nothing', async () => {
    down = true
    await press('t')
    await settle()
    expect(fake().calls).toContainEqual(['POST', '/api/tasks/a/schedule', { date: TODAY }])
    expect(shown()).toBe(RUNNING)
  })

  it("an error answer shows the server's message, and the refetch shows the true state", async () => {
    onWrite = () => {
      throw new ApiError(400, 'invalid', 'Title is too long')
    }
    await rename('Renamed')
    await settle()
    expect(shown()).toBe('Title is too long')
    await waitFor(() => expect(screen.getByText('Task a')).toBeTruthy())
    expect(screen.queryByText('Renamed')).toBeNull()
  })

  it('once the server answers again, the next refetch shows its state', async () => {
    down = true
    await rename('Renamed')
    await settle()
    down = false
    title = 'Renamed elsewhere'
    await rename('Second try')
    await settle()
    await waitFor(() => expect(screen.getByText('Renamed elsewhere')).toBeTruthy())
  })
})

describe('reportWriteError', () => {
  it('is silent for a write skipped because its task was never created', () => {
    reportWriteError(new SkippedWrite('new:1'))
    expect(toast.current()).toBeNull()
  })

  it('treats an answer without a Daybreak error body (the dev proxy, server down) as not running', () => {
    reportWriteError(new ApiError(500, 'http_error', 'HTTP 500'))
    expect(shown()).toBe(RUNNING)
  })

  it('a newer toast replaces older ones: an error after a delete replaces its Undo, an earlier one does not', () => {
    reportWriteError(new Unreachable(null))
    toast.show({ message: "Deleted 'Task a'", restoreId: 'a', restoreIn: ['tree'] })
    expect(toast.current()?.restoreId).toBe('a')
    reportWriteError(new Unreachable(null))
    expect(toast.current()).toMatchObject({ message: RUNNING })
    expect(toast.current()?.restoreId).toBeUndefined()
  })
})
