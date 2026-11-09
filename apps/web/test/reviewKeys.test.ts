import type { ReviewItem, ReviewView } from '@daybreak/core'
import { describe, expect, it } from 'vitest'
import type { KeyLike } from '../src/keyboard/keymap'
import { applyDecision, currentItem, resolveReviewKey, undoLast } from '../src/review/reviewKeys'
import { node } from './helpers'

const key = (k: string, m: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m,
})
const open = { pickerOpen: false, allSorted: false }

function item(id: string, group: ReviewItem['group'], decision: ReviewItem['decision'] = null): ReviewItem {
  return { task: node(id), path: [], group, decision, workedOn: null, scheduledOn: '2026-11-06',
    leftoverFrom: group === 'leftover' ? '2026-11-06' : null }
}
function view(leftovers: ReviewItem[], suggestions: ReviewItem[]): ReviewView {
  const all = [...leftovers, ...suggestions]
  return {
    date: '2026-11-09', leftovers, suggestions, totalCount: all.length,
    sortedCount: all.filter((i) => i.decision).length, todayCount: 0, finished: false, skipped: false,
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

  it('Space starts the day only once everything is sorted', () => {
    expect(resolveReviewKey(key(' '), open)).toBeNull()
    expect(resolveReviewKey(key(' '), { pickerOpen: false, allSorted: true })).toBe('start')
  })

  it('gives null for everything while the picker is open', () => {
    const ctx = { pickerOpen: true, allSorted: true }
    for (const k of ['t', 'd', 'b', 'x', 'z', ' ', 'Escape']) expect(resolveReviewKey(key(k), ctx)).toBeNull()
  })

  it('gives null for Esc (the review does not close)', () => {
    expect(resolveReviewKey(key('Escape'), open)).toBeNull()
  })
})

describe('currentItem', () => {
  it('is the first undecided leftover', () => {
    const v = view([item('a', 'leftover', { choice: 'today' }), item('b', 'leftover'), item('c', 'leftover')], [item('s', 'suggestion')])
    expect(currentItem(v)?.task.id).toBe('b')
  })

  it('goes to the suggestions after the leftovers, skipping decided ones', () => {
    const v = view([item('a', 'leftover', { choice: 'backlog' })], [item('s', 'suggestion', { choice: 'backlog' }), item('t', 'suggestion')])
    expect(currentItem(v)?.task.id).toBe('t')
  })

  it('is null once everything is decided', () => {
    expect(currentItem(view([item('a', 'leftover', { choice: 'cancel' })], []))).toBeNull()
  })
})

describe('optimistic decisions', () => {
  it('applyDecision marks the item and counts it', () => {
    const v = applyDecision(view([item('a', 'leftover'), item('b', 'leftover')], []), 'a', { choice: 'today', date: '2026-11-09' })
    expect(v.leftovers[0]!.decision).toEqual({ choice: 'today', date: '2026-11-09' })
    expect(v.sortedCount).toBe(1)
    expect(v.todayCount).toBe(1)
    expect(currentItem(v)?.task.id).toBe('b')
  })

  it('undoLast reverts the last decided suggestion, else the last decided leftover', () => {
    const v = view(
      [item('a', 'leftover', { choice: 'today', date: '2026-11-09' }), item('b', 'leftover', { choice: 'backlog' })],
      [item('s', 'suggestion', { choice: 'day', date: '2026-11-11' }), item('t', 'suggestion')],
    )
    const once = undoLast(v)
    expect(once.suggestions[0]!.decision).toBeNull()
    expect(once.sortedCount).toBe(2)
    const twice = undoLast(once)
    expect(twice.leftovers[1]!.decision).toBeNull()
    expect(currentItem(twice)?.task.id).toBe('b')
    const empty = view([item('a', 'leftover')], [])
    expect(undoLast(empty)).toBe(empty)
  })
})
