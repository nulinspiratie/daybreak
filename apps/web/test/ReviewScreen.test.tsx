// @vitest-environment happy-dom
import type { ReviewChoice, ReviewItem, ReviewView } from '@daybreak/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { queue, useDrainInvalidation } from '../src/api/hooks'
import { ReviewScreen, useOpenReviewWhenDue } from '../src/review/ReviewScreen'
import { useToastStore } from '../src/shell/toastStore'
import { useUi } from '../src/ui/store'
import { type FakeApi, node } from './helpers'

const shared = vi.hoisted(() => ({ fake: null as FakeApi | null }))
vi.mock('../src/api/client', async (importOriginal) => {
  const { createFakeApi } = await import('./helpers')
  shared.fake = createFakeApi()
  return { ...(await importOriginal<typeof import('../src/api/client')>()), api: shared.fake.api }
})
const fake = () => shared.fake!

const MONDAY = '2026-11-09'
const FRIDAY = '2026-11-06'
const THURSDAY = '2026-11-05'
const R = `/api/review/${MONDAY}`

/**
 * A tiny stand-in for the server's review: decisions apply in order, a decided item can be
 * decided again (its old choice is dropped), undo reverts the latest.
 */
let server: ReviewView
let order: string[] = []
let needsReview = true
let statusToday = MONDAY
let failDecide = false
let seq = 0

function item(id: string, group: ReviewItem['group'], over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    task: node(id, [], { title: `Task ${id}`, scheduledOn: group === 'leftover' ? FRIDAY : null }),
    path: ['Fridge 3 readout upgrade', 'Milestone 2'],
    group,
    decision: null,
    workedOn: null,
    scheduledOn: group === 'leftover' ? FRIDAY : null,
    leftoverFrom: group === 'leftover' ? FRIDAY : null,
    ...over,
  }
}
function build(leftovers: ReviewItem[], suggestions: ReviewItem[]): ReviewView {
  return {
    date: MONDAY,
    leftovers,
    suggestions,
    sortedCount: 0,
    totalCount: leftovers.length + suggestions.length,
    todayCount: 2,
    finished: false,
    skipped: false,
  }
}
const items = () => [...server.leftovers, ...server.suggestions]
function recount() {
  server.sortedCount = items().filter((i) => i.decision).length
}

function reply(method: string, path: string, body?: unknown): unknown {
  if (path === '/api/status') return { today: statusToday, needsReview, dayStartsAt: '04:00' }
  if (path.startsWith('/api/days')) return {}
  if (method === 'GET' && path === R) return structuredClone(server)
  if (path === `${R}/decide`) {
    if (failDecide) throw new ApiError(500, 'internal', 'boom')
    const b = body as { taskId: string; choice: ReviewChoice; targetDate?: string }
    const it = items().find((i) => i.task.id === b.taskId)
    if (!it) throw new ApiError(400, 'invalid', 'not in this review')
    if (it.decision) {
      if (it.decision.choice === 'today') server.todayCount--
      order = order.filter((id) => id !== b.taskId)
    }
    it.decision = {
      choice: b.choice,
      ...(b.choice === 'today' ? { date: MONDAY } : b.targetDate ? { date: b.targetDate } : {}),
      seq: ++seq,
    }
    // Like the server, the item shows the task's day as it is now.
    if (b.choice === 'today') it.scheduledOn = MONDAY
    if (b.choice === 'day') it.scheduledOn = b.targetDate!
    if (b.choice === 'backlog' && it.group === 'leftover') it.scheduledOn = null
    if (b.choice === 'today') server.todayCount++
    order.push(b.taskId)
    recount()
    return structuredClone(server)
  }
  if (path === `${R}/undo`) {
    const id = order.pop()
    const it = items().find((i) => i.task.id === id)
    if (it) {
      if (it.decision?.choice === 'today') server.todayCount--
      it.decision = null
    }
    recount()
    return structuredClone(server)
  }
  if (path === `${R}/skip` || path === `${R}/finish`) return undefined
  throw new Error(`unexpected ${method} ${path}`)
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
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

function Harness() {
  useDrainInvalidation()
  useOpenReviewWhenDue()
  const open = useUi((s) => s.reviewOpen)
  return open ? <ReviewScreen /> : <p>Main window</p>
}

let qc: QueryClient
async function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  )
  await screen.findByText('Plan today, top to bottom')
  await flush()
}

/** The row (or card) that shows a task's title. */
const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement

beforeEach(() => {
  server = build(
    [item('a', 'leftover'), item('b', 'leftover')],
    [item('s', 'suggestion', { path: ['Inbox'] })],
  )
  order = []
  seq = 0
  needsReview = true
  statusToday = MONDAY
  failDecide = false
  fake().calls.length = 0
  fake().reply = reply
  useUi.getState().set({ reviewOpen: false })
  useToastStore.setState({ toast: null })
})
afterEach(async () => {
  await flush()
  cleanup()
})

describe('ReviewScreen', () => {
  it('opens by itself when the status says the review is due, with the layout and copy', async () => {
    await mount()
    expect(ui().reviewOpen).toBe(true)
    expect(screen.getByText('Good morning — Monday 9 November')).toBeTruthy()
    expect(screen.getByText('0 of 3 done')).toBeTruthy()
    expect(screen.getByText('ANYTHING ELSE FOR TODAY?')).toBeTruthy()
    expect(screen.getByText('Suggestions from your tree and Inbox')).toBeTruthy()
    expect(screen.getByText('0 of 2 sorted')).toBeTruthy()
    const card = rowOf('Task a')
    expect(within(card).getByText('1 of 2')).toBeTruthy()
    expect(within(card).getByText('Fridge 3 readout upgrade › Milestone 2')).toBeTruthy()
    expect(within(card).getByRole('button', { name: /Backlog/ })).toBeTruthy()
    expect(screen.getByText('2 tasks for today')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skip for today' })).toBeTruthy()
  })

  it('heading names the weekday when all leftovers are from one day', async () => {
    await mount()
    expect(screen.getByText('LEFT OVER FROM FRIDAY')).toBeTruthy()
  })

  it('heading says EARLIER when the leftovers are from different days', async () => {
    server.leftovers[1] = item('b', 'leftover', { scheduledOn: THURSDAY, leftoverFrom: THURSDAY })
    await mount()
    expect(screen.getByText('LEFT OVER FROM EARLIER')).toBeTruthy()
  })

  it('the heading keeps its day as leftovers are sorted', async () => {
    server.leftovers[0] = item('a', 'leftover', { scheduledOn: THURSDAY, leftoverFrom: THURSDAY })
    await mount()
    expect(screen.getByText('LEFT OVER FROM EARLIER')).toBeTruthy()
    await press('t') // a moves to today; only Friday's b still shows an old day
    await flush()
    expect(screen.getByText('LEFT OVER FROM EARLIER')).toBeTruthy()
  })

  it('the heading reads the original days of leftovers sorted before the screen opened (a reload mid-review)', async () => {
    server.leftovers[0] = item('a', 'leftover', {
      scheduledOn: MONDAY,
      leftoverFrom: THURSDAY,
      decision: { choice: 'today', date: MONDAY, seq: ++seq },
    })
    order = ['a']
    recount()
    await mount()
    expect(screen.getByText('LEFT OVER FROM EARLIER')).toBeTruthy()
    expect(within(rowOf('Task a')).getByText('Today')).toBeTruthy()
  })

  it('T on the current card posts decide today and the row turns into a decided row with chip "Today"', async () => {
    await mount()
    await press('t')
    await flush()
    expect(writes()).toEqual([['POST', `${R}/decide`, { taskId: 'a', choice: 'today' }]])
    const row = rowOf('Task a')
    expect(row.classList.contains('rv-row--today')).toBe(true)
    expect(within(row).getByText('Today')).toBeTruthy()
    expect(within(rowOf('Task b')).getByText('2 of 2')).toBeTruthy() // b is the current card now
    expect(screen.getByText('1 of 3 done')).toBeTruthy()
    expect(screen.getByText('1 of 2 sorted')).toBeTruthy()
    expect(screen.getByText('3 tasks for today')).toBeTruthy()
  })

  it('T T T goes down the list in order, into the suggestions', async () => {
    await mount()
    await press('t')
    await press('b')
    await press('t')
    await flush()
    expect(writes().map((w) => (w[2] as { taskId: string }).taskId)).toEqual(['a', 'b', 's'])
    expect(within(rowOf('Task b')).getByText('Backlog')).toBeTruthy()
    expect(within(rowOf('Task s')).getByText('Today')).toBeTruthy()
  })

  it('T T T with the replies still in flight goes down the list in order', async () => {
    await mount()
    const held: Array<() => void> = []
    fake().reply = (m, p, b) =>
      p === `${R}/decide` ? new Promise((r) => held.push(() => r(reply(m, p, b)))) : reply(m, p, b)
    /** Lets renders and in-flight posts move on, without waiting for the queue to drain. */
    const tick = () =>
      act(async () => {
        for (let t = 0; t < 5; t++) await new Promise((r) => setTimeout(r, 0))
      })
    await press('t')
    await press('t')
    await press('t')
    await tick()
    expect(held).toHaveLength(1) // the first post is in flight, the other two wait in the queue
    expect(screen.getByText('3 of 3 done')).toBeTruthy() // shown at once
    expect(screen.getByText('5 tasks for today')).toBeTruthy()
    for (let i = 0; i < 3; i++) {
      expect(held).toHaveLength(1)
      held.shift()!()
      await tick()
      expect(screen.getByText('3 of 3 done')).toBeTruthy() // an early reply never shows a step back
    }
    await flush()
    expect(writes().map((w) => (w[2] as { taskId: string }).taskId)).toEqual(['a', 'b', 's'])
    expect(order).toEqual(['a', 'b', 's'])
    expect(screen.getByText('3 of 3 done')).toBeTruthy()
    expect(screen.getByText('5 tasks for today')).toBeTruthy()
    for (const t of ['Task a', 'Task b', 'Task s'])
      expect(within(rowOf(t)).getByText('Today')).toBeTruthy()
    expect(document.querySelector('.rv-card')).toBeNull()
  })

  it('D opens the picker inside the card; pressing 3 posts decide day with today+2', async () => {
    await mount()
    await press('d')
    const card = rowOf('Task a')
    const input = within(card).getByRole('textbox', { name: 'Day' })
    expect(document.activeElement).toBe(input)
    await press('t') // typed into the picker, not a decision
    expect(writes()).toEqual([])
    await press('3')
    await press('Enter')
    await flush()
    expect(writes()).toEqual([
      ['POST', `${R}/decide`, { taskId: 'a', choice: 'day', targetDate: '2026-11-11' }],
    ])
    expect(screen.queryByRole('textbox', { name: 'Day' })).toBeNull()
    expect(within(rowOf('Task a')).getByText('Wed')).toBeTruthy()
  })

  it('Esc closes the picker and otherwise does nothing', async () => {
    await mount()
    await press('d')
    await press('Escape')
    expect(screen.queryByRole('textbox', { name: 'Day' })).toBeNull()
    await press('Escape')
    expect(ui().reviewOpen).toBe(true)
    expect(writes()).toEqual([])
  })

  it('a suggestion offers Not today on B, and B shows a "Not today" chip', async () => {
    server = build([], [item('s', 'suggestion')])
    await mount()
    expect(within(rowOf('Task s')).getByText('Suggestion')).toBeTruthy()
    expect(within(rowOf('Task s')).getByRole('button', { name: /Not today/ })).toBeTruthy()
    await press('b')
    await flush()
    expect(writes()).toEqual([['POST', `${R}/decide`, { taskId: 's', choice: 'backlog' }]])
    expect(within(rowOf('Task s')).getByText('Not today')).toBeTruthy()
  })

  it('shows the worked-on chip and the note on the current card', async () => {
    server = build(
      [
        item('a', 'leftover', {
          workedOn: FRIDAY,
          task: node('a', [], { title: 'Task a', notes: 'Sweeps still fail.' }),
        }),
      ],
      [],
    )
    await mount()
    expect(screen.getByText('Worked on Friday')).toBeTruthy()
    expect(screen.getByText('Continue today?')).toBeTruthy()
    expect(screen.getByText('Sweeps still fail.')).toBeTruthy()
  })

  it('Z posts undo', async () => {
    await mount()
    await press('x')
    await flush()
    expect(rowOf('Task a').classList.contains('rv-row--cancelled')).toBe(true)
    await press('z')
    await flush()
    expect(writes()).toEqual([
      ['POST', `${R}/decide`, { taskId: 'a', choice: 'cancel' }],
      ['POST', `${R}/undo`, undefined],
    ])
    expect(within(rowOf('Task a')).getByText('1 of 2')).toBeTruthy() // the current card again
  })

  it('clicking a card button decides too', async () => {
    await mount()
    const another = within(rowOf('Task a')).getByRole('button', { name: /Another day/ })
    fireEvent.click(another)
    expect(screen.getByRole('textbox', { name: 'Day' })).toBeTruthy()
    fireEvent.click(another)
    expect(screen.queryByRole('textbox', { name: 'Day' })).toBeNull()
    fireEvent.click(within(rowOf('Task a')).getByRole('button', { name: /Cancel/ }))
    await flush()
    expect(writes()).toEqual([['POST', `${R}/decide`, { taskId: 'a', choice: 'cancel' }]])
    expect(within(rowOf('Task a')).getByText('Cancelled')).toBeTruthy()
  })

  it('a mouse click on a title-bar button hands focus back, so Space is not that button again', async () => {
    await mount()
    const theme = screen.getByRole('button', { name: /theme/ })
    theme.focus()
    fireEvent.click(theme, { detail: 1 })
    expect(document.activeElement).not.toBe(theme)
    expect(document.activeElement?.classList.contains('review')).toBe(true)
  })

  it('Space marks the item done: a "Done" chip, and the screen stays open', async () => {
    await mount()
    expect(within(rowOf('Task a')).getByRole('button', { name: /Done/ })).toBeTruthy()
    await press(' ')
    await flush()
    expect(writes()).toEqual([['POST', `${R}/decide`, { taskId: 'a', choice: 'done' }]])
    const row = rowOf('Task a')
    expect(row.classList.contains('rv-row--done')).toBe(true)
    expect(within(row).getByText('Done')).toBeTruthy()
    expect(within(rowOf('Task b')).getByText('2 of 2')).toBeTruthy()
    expect(ui().reviewOpen).toBe(true)
  })

  it('on the end row before everything is sorted, Space does nothing', async () => {
    await mount()
    for (let i = 0; i < 4; i++) await press('ArrowDown')
    expect(document.querySelector('.rv-end.is-current')).not.toBeNull()
    expect(document.querySelector('.rv-card')).toBeNull()
    await press(' ')
    await flush()
    expect(writes()).toEqual([])
    expect(ui().reviewOpen).toBe(true)
  })

  it('↑ goes back to a decided item, which shows its choice and can be changed', async () => {
    await mount()
    await press('t')
    await press('b')
    await flush()
    await press('ArrowUp')
    await press('ArrowUp')
    const card = rowOf('Task a')
    expect(card.classList.contains('rv-card')).toBe(true)
    expect(card.querySelector('.rv-card__chip')?.textContent).toBe('Today')
    expect(within(card).getByRole('button', { name: /Today/ }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    await press('x')
    await flush()
    expect(writes().at(-1)).toEqual(['POST', `${R}/decide`, { taskId: 'a', choice: 'cancel' }])
    expect(rowOf('Task a').classList.contains('rv-row--cancelled')).toBe(true)
    expect(screen.getByText('2 of 3 done')).toBeTruthy()
    expect(screen.getByText('2 tasks for today')).toBeTruthy()
    // The cursor moves on to the next undecided item, the suggestion.
    expect(within(rowOf('Task s')).getByText('Suggestion')).toBeTruthy()
  })

  it('↓ skips ahead; a later Z returns the cursor to the item undone', async () => {
    await mount()
    await press('ArrowDown')
    expect(within(rowOf('Task b')).getByText('2 of 2')).toBeTruthy()
    await press('b')
    await flush()
    expect(writes()).toEqual([['POST', `${R}/decide`, { taskId: 'b', choice: 'backlog' }]])
    expect(within(rowOf('Task s')).getByText('Suggestion')).toBeTruthy() // next undecided below
    await press('z')
    await flush()
    expect(within(rowOf('Task b')).getByText('2 of 2')).toBeTruthy()
    expect(rowOf('Task a').classList.contains('rv-next')).toBe(true)
  })

  it('a click on a row puts the cursor there', async () => {
    await mount()
    fireEvent.click(screen.getByText('Task s'))
    expect(within(rowOf('Task s')).getByText('Suggestion')).toBeTruthy()
    expect(rowOf('Task a').classList.contains('rv-next')).toBe(true)
  })

  it('Space when all sorted posts finish and closes the screen', async () => {
    await mount()
    await press('t')
    await press('t')
    await press('b')
    await flush()
    expect(document.querySelector('.rv-end.is-current')).not.toBeNull()
    needsReview = false
    await press(' ')
    await flush()
    expect(writes().at(-1)).toEqual(['POST', `${R}/finish`, undefined])
    expect(ui().reviewOpen).toBe(false)
    expect(screen.getByText('Main window')).toBeTruthy()
  })

  it('closes when the day turns and the new day has no review due', async () => {
    await mount()
    statusToday = '2026-11-10'
    needsReview = false
    await act(() => qc.invalidateQueries({ queryKey: ['status'] }))
    await flush()
    expect(ui().reviewOpen).toBe(false)
    expect(screen.getByText('Main window')).toBeTruthy()
  })

  it('a review opened from the title bar (none due) stays open while the day stays the same', async () => {
    needsReview = false
    useUi.getState().set({ reviewOpen: true })
    await mount()
    await act(() => qc.invalidateQueries({ queryKey: ['status'] }))
    await flush()
    expect(ui().reviewOpen).toBe(true)
  })

  it('Start the day is clickable before everything is sorted', async () => {
    await mount()
    needsReview = false
    fireEvent.click(screen.getByRole('button', { name: /Start the day/ }))
    await flush()
    expect(writes()).toEqual([['POST', `${R}/finish`, undefined]])
    expect(ui().reviewOpen).toBe(false)
  })

  it('Skip for today posts skip', async () => {
    await mount()
    needsReview = false
    fireEvent.click(screen.getByRole('button', { name: 'Skip for today' }))
    await flush()
    expect(writes()).toEqual([['POST', `${R}/skip`, undefined]])
    expect(ui().reviewOpen).toBe(false)
    expect(screen.getByText('Main window')).toBeTruthy()
  })

  it('a failed decision shows a toast and the row goes back to undecided', async () => {
    failDecide = true
    await mount()
    await press('t')
    await flush()
    expect(useToastStore.getState().toast?.message).toBe("Couldn't save that choice")
    expect(within(rowOf('Task a')).getByText('1 of 2')).toBeTruthy()
  })
})
