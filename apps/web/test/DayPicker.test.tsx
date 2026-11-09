// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayPicker } from '../src/picker/DayPicker'
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

beforeEach(() => {
  onPick = vi.fn<(d: string | null) => void>()
  onClose = vi.fn<() => void>()
  shared.fake!.reply = (_m, path) => (path.startsWith('/api/days') ? { '2026-11-10': 5, '2026-11-12': 2 } : undefined)
})
afterEach(() => cleanup())

describe('DayPicker', () => {
  it('focuses its input', () => {
    expect(mount()).toBe(document.activeElement)
  })

  it('pressing 3 picks today+2', () => {
    const input = mount()
    fireEvent.keyDown(input, { key: '3' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-11')
  })

  it('typing "fri" then Enter picks Friday', () => {
    const input = mount()
    type(input, 'fri')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-13')
  })

  it('typing "20 nov" types digits instead of picking', () => {
    const input = mount()
    type(input, '2')
    fireEvent.keyDown(input, { key: '0' })
    expect(onPick).not.toHaveBeenCalled()
    type(input, '20 nov')
    expect(screen.getByRole('button', { name: /^Fri 20 Nov/ }).className).toContain('is-on')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledExactlyOnceWith('2026-11-20')
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

  it('Esc calls onClose', () => {
    fireEvent.keyDown(mount(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows the open-task count of each day', async () => {
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
