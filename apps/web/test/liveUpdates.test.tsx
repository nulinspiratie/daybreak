// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLiveUpdates } from '../src/api/hooks'

const sse = vi.hoisted(() => ({ dayChanged: (_today: string) => {} }))
vi.mock('../src/api/sse', () => ({
  connectEvents: (_onChanged: () => void, onDayChanged: (today: string) => void) => {
    sse.dayChanged = onDayChanged
    return () => {}
  },
}))

function Harness() {
  useLiveUpdates()
  return null
}

afterEach(cleanup)

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
