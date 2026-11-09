// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayPicker, QUICK_PICK_MS } from '../src/picker/DayPicker'
import { type FakeApi } from './helpers'

const shared = vi.hoisted(() => ({ fake: null as FakeApi | null }))
vi.mock('../src/api/client', async (importOriginal) => {
  const { createFakeApi } = await import('./helpers')
  shared.fake = createFakeApi()
  return { ...(await importOriginal<typeof import('../src/api/client')>()), api: shared.fake.api }
})

const TODAY = '2026-11-09' // a Monday
let onPick: ReturnType<typeof vi.fn<(d: string | null) => void>>
let onClose: ReturnType<typeof vi.fn<() => void>>

function mount(props: { allowNoDay?: boolean; initial?: string | null } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DayPicker today={TODAY} allowNoDay={props.allowNoDay ?? true} initial={props.initial} onPick={onPick} onClose={onClose} />
    </QueryClientProvider>,
  )
  return screen.getByRole('textbox') as HTMLInputElement
}
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } })
/** One real key press into the field: keydown, and, if the picker let it through, the input it would make. */
function key(input: HTMLInputElement, k: string) {
  const proceeded = fireEvent.keyDown(input, { key: k })
  if (proceeded && k.length === 1) type(input, input.value + k)
}
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onPick = vi.fn<(d: string | null) => void>()
  onClose = vi.fn<() => void>()
  shared.fake!.reply = (_m, path) => (path.startsWith('/api/days') ? { '2026-11-10': 5, '2026-11-12': 2 } : undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DayPicker', () => {
  it('focuses its input', () => {
    expect(mount()).toBe(document.activeElement)
  })

  it('pressing 3 types it, highlights today+2 and picks it after the delay', () => {
    const input = mount()
    key(input, '3')
    expect(input.value).toBe('3')
    expect(screen.getByRole('button', { name: /^Wed 11 Nov/ }).className).toContain('is-on')
    wait(QUICK_PICK_MS - 1)
    expect(onPick).not.toHaveBeenCalled()
    wait(1)
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-11')
  })

  it('3 then Enter picks today+2 at once, and only once', () => {
    const input = mount()
    key(input, '3')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-11')
    wait(1000)
    expect(onPick).toHaveBeenCalledOnce()
  })

  it('Backspace cancels a quick pick and clears the field', () => {
    const input = mount()
    key(input, '3')
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(input.value).toBe('')
    wait(1000)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Esc closes during a quick pick without picking', () => {
    const input = mount()
    key(input, '3')
    fireEvent.keyDown(input, { key: 'Escape' })
    wait(1000)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('typing "fri" then Enter picks Friday', () => {
    const input = mount()
    type(input, 'fri')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-13')
  })

  it('typing "20 nov" key by key cancels the quick pick and picks 20 Nov', () => {
    const input = mount()
    key(input, '2')
    key(input, '0')
    wait(1000)
    expect(onPick).not.toHaveBeenCalled()
    for (const ch of ' nov') key(input, ch)
    expect(input.value).toBe('20 nov')
    expect(screen.getByRole('button', { name: /^Fri 20 Nov/ }).className).toContain('is-on')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-20')
  })

  it('"15 nov" works too', () => {
    const input = mount()
    for (const ch of '15 nov') key(input, ch)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-15')
  })

  it('picks a typed day outside the grid and shows it', () => {
    const input = mount()
    type(input, '20 dec')
    expect(screen.getByText(/20 Dec/)).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-12-20')
  })

  it('does nothing on Enter when the text does not parse', () => {
    const input = mount()
    type(input, 'blorp')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('ArrowDown then Enter picks today+7', () => {
    const input = mount()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-16')
  })

  it('arrows clamp at today and at the end of the grid', () => {
    const input = mount()
    fireEvent.keyDown(input, { key: 'ArrowLeft' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith(TODAY)
    for (let i = 0; i < 6; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('2026-12-13')
  })

  it('starts the highlight at initial when it is in the grid, else today', () => {
    const input = mount({ initial: '2026-11-12' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('2026-11-12')
    cleanup()
    const input2 = mount({ initial: '2025-01-01' })
    fireEvent.keyDown(input2, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith(TODAY)
  })

  it('after typing "fri", ArrowDown clears the text and moves a week from Friday', () => {
    const input = mount()
    type(input, 'fri')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.value).toBe('')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-20')
  })

  it('says so when the typed day has passed, and Enter does nothing', () => {
    const input = mount()
    type(input, '2026-11-01')
    expect(screen.getByText('That day has passed')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('moving the pointer highlights a quick day; merely resting it there does not', () => {
    const input = mount()
    const row = screen.getByText('Tomorrow · Tue 10').closest('button')!
    fireEvent.mouseEnter(row)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith(TODAY)
    fireEvent.mouseMove(row)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('2026-11-10')
  })

  it('shows dots up to 4 tasks and the number above', async () => {
    vi.useRealTimers()
    shared.fake!.reply = (_m, path) => (path.startsWith('/api/days') ? { '2026-11-10': 4, '2026-11-12': 12 } : undefined)
    mount()
    const label = (name: RegExp) => screen.findByRole('button', { name })
    expect((await label(/Tomorrow · Tue 10, 4 tasks/)).textContent).toContain('••••')
    expect((await label(/Thu 12 Nov, 12 tasks/)).textContent).toContain('12')
  })

  it('says so when the counts cannot be had', async () => {
    vi.useRealTimers()
    shared.fake!.reply = (_m, path) => {
      if (path.startsWith('/api/days')) throw new Error('down')
      return undefined
    }
    mount()
    expect(await screen.findByText('Counts unavailable')).toBeTruthy()
  })

  it('Esc calls onClose', () => {
    fireEvent.keyDown(mount(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows the open-task count of each day', async () => {
    vi.useRealTimers() // findBy waits on timers
    mount()
    expect(await screen.findByRole('button', { name: /Tomorrow · Tue 10, 5 tasks/ })).toBeTruthy()
  })

  it('clicking a day picks it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Fri 13 Nov/ }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-13')
  })

  it('shows a No day button only when allowNoDay', () => {
    mount({ allowNoDay: true })
    fireEvent.click(screen.getByRole('button', { name: 'No day' }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(null)
    cleanup()
    mount({ allowNoDay: false })
    expect(screen.queryByRole('button', { name: 'No day' })).toBeNull()
  })
})
