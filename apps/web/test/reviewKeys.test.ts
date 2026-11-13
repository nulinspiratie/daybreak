import type { ReviewItem, ReviewView } from '@daybreak/core'
import { describe, expect, it } from 'vitest'
import type { KeyLike } from '../src/keyboard/keymap'
import {
  afterDecision,
  applyDecision,
  currentItem,
  END,
  resolveReviewKey,
  spotIn,
  step,
  undoLast,
} from '../src/review/reviewKeys'
import { node } from './helpers'

const key = (k: string, m: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...m,
})
const open = { pickerOpen: false, allSorted: false, onItem: true }

let seq = 0
function item(
  id: string,
  group: ReviewItem['group'],
  d: Omit<NonNullable<ReviewItem['decision']>, 'seq'> | null = null,
): ReviewItem {
  const decision = d && { ...d, seq: ++seq }
  return {
    task: node(id),
    path: [],
    group,
    decision,
    workedOn: null,
    scheduledOn: '2026-11-06',
    leftoverFrom: group === 'leftover' ? '2026-11-06' : null,
  }
}
function view(leftovers: ReviewItem[], suggestions: ReviewItem[]): ReviewView {
  const all = [...leftovers, ...suggestions]
  return {
    date: '2026-11-09',
    leftovers,
    suggestions,
    totalCount: all.length,
    sortedCount: all.filter((i) => i.decision).length,
    todayCount: 0,
    finished: false,
    skipped: false,
  }
}

describe('resolveReviewKey', () => {
  it('maps t d b x z, in either case', () => {
    expect(resolveReviewKey(key('t'), open)).toBe('today')
    expect(resolveReviewKey(key('d'), open)).toBe('day')
    expect(resolveReviewKey(key('b'), open)).toBe('backlog')
    expect(resolveReviewKey(key('x'), open)).toBe('cancel')
    expect(resolveReviewKey(key('z'), open)).toBe('undo')
    expect(resolveReviewKey(key('T', { shiftKey: true }), open)).toBe('today')
  })

  it('gives null for the old keys a s f and for chords', () => {
    expect(resolveReviewKey(key('a'), open)).toBeNull()
    expect(resolveReviewKey(key('s'), open)).toBeNull()
    expect(resolveReviewKey(key('f'), open)).toBeNull()
    expect(resolveReviewKey(key('t', { ctrlKey: true }), open)).toBeNull()
    expect(resolveReviewKey(key('z', { altKey: true }), open)).toBeNull()
    expect(resolveReviewKey(key('z', { metaKey: true }), open)).toBeNull()
  })

  it('Space is done on an item; on the end row it starts the day once everything is sorted', () => {
    expect(resolveReviewKey(key(' '), open)).toBe('done')
    expect(resolveReviewKey(key(' '), { ...open, allSorted: true })).toBe('done')
    expect(resolveReviewKey(key(' '), { ...open, onItem: false })).toBeNull()
    expect(resolveReviewKey(key(' '), { ...open, onItem: false, allSorted: true })).toBe('start')
  })

  it('maps ↑ and ↓ to up and down', () => {
    expect(resolveReviewKey(key('ArrowUp'), open)).toBe('up')
    expect(resolveReviewKey(key('ArrowDown'), { ...open, onItem: false })).toBe('down')
    expect(resolveReviewKey(key('ArrowUp', { altKey: true }), open)).toBeNull()
  })

  it('gives null for everything while the picker is open', () => {
    const ctx = { pickerOpen: true, allSorted: true, onItem: true }
    for (const k of ['t', 'd', 'b', 'x', 'z', ' ', 'Escape', 'ArrowUp', 'ArrowDown'])
      expect(resolveReviewKey(key(k), ctx)).toBeNull()
  })

  it('gives null for Esc (the review does not close)', () => {
    expect(resolveReviewKey(key('Escape'), open)).toBeNull()
  })
})

describe('currentItem', () => {
  it('is the first undecided leftover', () => {
    const v = view(
      [item('a', 'leftover', { choice: 'today' }), item('b', 'leftover'), item('c', 'leftover')],
      [item('s', 'suggestion')],
    )
    expect(currentItem(v)?.task.id).toBe('b')
  })

  it('goes to the suggestions after the leftovers, skipping decided ones', () => {
    const v = view(
      [item('a', 'leftover', { choice: 'backlog' })],
      [item('s', 'suggestion', { choice: 'backlog' }), item('t', 'suggestion')],
    )
    expect(currentItem(v)?.task.id).toBe('t')
  })

  it('is null once everything is decided', () => {
    expect(currentItem(view([item('a', 'leftover', { choice: 'cancel' })], []))).toBeNull()
  })
})

describe('the cursor', () => {
  const v = () =>
    view(
      [item('a', 'leftover', { choice: 'today' }), item('b', 'leftover'), item('c', 'leftover')],
      [item('s', 'suggestion')],
    )

  it('spotIn is the chosen item while it is listed, else the first undecided, else the end row', () => {
    expect(spotIn(v(), null)).toBe('b')
    expect(spotIn(v(), 'a')).toBe('a')
    expect(spotIn(v(), 'gone')).toBe('b')
    expect(spotIn(v(), END)).toBe(END)
    expect(spotIn(view([item('a', 'leftover', { choice: 'cancel' })], []), null)).toBe(END)
  })

  it('step moves through leftovers, suggestions and the end row, and stops at both ends', () => {
    expect(step(v(), 'b', -1)).toBe('a')
    expect(step(v(), 'a', -1)).toBe('a')
    expect(step(v(), 'c', 1)).toBe('s')
    expect(step(v(), 's', 1)).toBe(END)
    expect(step(v(), END, 1)).toBe(END)
    expect(step(v(), END, -1)).toBe('s')
  })

  it('afterDecision goes to the next undecided below, else the first above, else the end row', () => {
    expect(afterDecision(v(), 'b')).toBe('c')
    const lastOpen = view(
      [item('a', 'leftover'), item('b', 'leftover', { choice: 'backlog' })],
      [item('s', 'suggestion', { choice: 'backlog' })],
    )
    expect(afterDecision(lastOpen, 's')).toBe('a')
    const allDone = view([item('a', 'leftover', { choice: 'done' })], [])
    expect(afterDecision(allDone, 'a')).toBe(END)
  })
})

describe('optimistic decisions', () => {
  it('applyDecision marks the item and counts it', () => {
    const v = applyDecision(view([item('a', 'leftover'), item('b', 'leftover')], []), 'a', {
      choice: 'today',
      date: '2026-11-09',
    })
    expect(v.leftovers[0]!.decision).toMatchObject({ choice: 'today', date: '2026-11-09' })
    expect(v.sortedCount).toBe(1)
    expect(v.todayCount).toBe(1)
    expect(currentItem(v)?.task.id).toBe('b')
  })

  it('applyDecision on a decided item changes it without counting it twice', () => {
    const before = view([item('a', 'leftover', { choice: 'today', date: '2026-11-09' })], [])
    const v = applyDecision({ ...before, todayCount: 1 }, 'a', { choice: 'done' })
    expect(v.leftovers[0]!.decision!.choice).toBe('done')
    expect(v.leftovers[0]!.decision!.seq).toBeGreaterThan(before.leftovers[0]!.decision!.seq)
    expect(v.sortedCount).toBe(1)
    expect(v.todayCount).toBe(0)
  })

  it('undoLast reverts the latest decision by seq, wherever it is in the list', () => {
    const b = item('b', 'leftover', { choice: 'backlog' })
    const a = item('a', 'leftover', { choice: 'today', date: '2026-11-09' }) // decided after b
    const v = view(
      [a, b],
      [item('s', 'suggestion'), item('t', 'suggestion', { choice: 'day', date: '2026-11-11' })],
    )
    const once = undoLast(v)
    expect(once.suggestions[1]!.decision).toBeNull()
    expect(once.sortedCount).toBe(2)
    const twice = undoLast(once)
    expect(twice.leftovers[0]!.decision).toBeNull()
    expect(twice.leftovers[1]!.decision).not.toBeNull()
    const empty = view([item('a', 'leftover')], [])
    expect(undoLast(empty)).toBe(empty)
  })
})
