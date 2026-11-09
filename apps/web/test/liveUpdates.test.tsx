// @vitest-environment happy-dom
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveUpdates, useStatus } from '../src/api/hooks'
import { TitleBar } from '../src/shell/TitleBar'
import { useUi } from '../src/ui/store'
import type { FakeApi } from './helpers'

const sse = vi.hoisted(() => ({
  dayChanged: (_today: string) => {},
  open: () => {},
  lost: () => {},
}))
vi.mock('../src/api/sse', () => ({
  connectEvents: (
    _onChanged: () => void,
    onDayChanged: (today: string) => void,
    stream: { open: () => void; lost: () => void },
  ) => {
    sse.dayChanged = onDayChanged
    sse.open = stream.open
    sse.lost = stream.lost
    return () => {}
  },
}))

const shared = vi.hoisted(() => ({ fake: null as FakeApi | null }))
vi.mock('../src/api/client', async (importOriginal) => {
  const { createFakeApi } = await import('./helpers')
  shared.fake = createFakeApi()
  return { ...(await importOriginal<typeof import('../src/api/client')>()), api: shared.fake.api }
})
const fake = () => shared.fake!
let today = '2026-11-09'
beforeEach(() => {
  today = '2026-11-09'
  fake().calls.length = 0
  fake().reply = (_method, path) =>
    path === '/api/status' ? { today, needsReview: false, dayStartsAt: '04:00' } : undefined
  useUi.getState().set({ reconnecting: false })
})

function Harness() {
  useLiveUpdates()
  return null
}

afterEach(cleanup)

function Today() {
  return <span data-testid="today">{useStatus().data?.today}</span>
}

describe('useLiveUpdates on day_changed', () => {
  it('refetches nothing at once, then the status on the next window focus or keydown', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    )
    act(() => sse.dayChanged('2026-11-10'))
    expect(spy).not.toHaveBeenCalled()

    fireEvent.focus(window)
    expect(spy).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'a' })
    expect(spy).toHaveBeenCalledTimes(1) // the flag is cleared

    act(() => sse.dayChanged('2026-11-11'))
    fireEvent.keyDown(document.body, { key: 't' })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('swallows the waking keydown, and every key, until the refetch has landed', async () => {
    const qc = new QueryClient()
    let land = () => {}
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => new Promise<void>((r) => (land = r)))
    const posted: string[] = []
    const app = (e: KeyboardEvent) => posted.push(e.key) // stands in for the app's handlers: T would post
    window.addEventListener('keydown', app)
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    )
    act(() => sse.dayChanged('2026-11-10'))
    const waking = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true })
    document.body.dispatchEvent(waking)
    expect(waking.defaultPrevented).toBe(true)
    fireEvent.keyDown(document.body, { key: 't' })
    expect(posted).toEqual([])
    await act(async () => land())
    fireEvent.keyDown(document.body, { key: 't' })
    expect(posted).toEqual(['t'])
    window.removeEventListener('keydown', app)
  })
})

describe('useLiveUpdates when the stream drops and comes back', () => {
  it('the first open refetches nothing; an error shows "Reconnecting…" until the next open, which refetches everything', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    qc.setQueryData(['status'], { today, needsReview: false, dayStartsAt: '04:00' })
    render(
      <QueryClientProvider client={qc}>
        <Harness />
        <TitleBar />
      </QueryClientProvider>,
    )
    act(() => sse.open())
    expect(spy).not.toHaveBeenCalled()
    expect(screen.queryByText('Reconnecting…')).toBeNull()

    act(() => sse.lost())
    expect(screen.getByText('Reconnecting…')).toBeTruthy()
    act(() => sse.lost()) // EventSource retries; each failed try is another error
    expect(spy).not.toHaveBeenCalled()

    act(() => sse.open())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith()
    expect(screen.queryByText('Reconnecting…')).toBeNull()
  })

  it('a reopen after the day boundary brings the new today', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <Harness />
        <Today />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-11-09'))
    act(() => sse.open())
    act(() => sse.lost())
    today = '2026-11-10' // the server restarted on the next day: no day_changed reaches this tab
    act(() => sse.open())
    await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-11-10'))
  })
})

describe('useStatus', () => {
  it('refetches on window focus, even with focus refetching off for everything else', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })
    render(
      <QueryClientProvider client={qc}>
        <Today />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-11-09'))
    today = '2026-11-10'
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-11-10'))
    focusManager.setFocused(undefined)
  })
})
