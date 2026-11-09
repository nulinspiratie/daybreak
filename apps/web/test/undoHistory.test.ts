import { describe, expect, it } from 'vitest'
import { createUndoHistory } from '../src/undo/history'

const entry = (label: string) => ({ label, revert: async () => {}, reapply: async () => {} })

describe('undo history', () => {
  it('takes the newest first, or a given entry', () => {
    const h = createUndoHistory()
    const a = h.push(entry('a'))
    h.push(entry('b'))
    h.push(entry('c'))
    expect(h.take()?.label).toBe('c')
    expect(h.take(a)?.label).toBe('a')
    expect(h.take()?.label).toBe('b')
    expect(h.take()).toBeUndefined()
  })

  it('drops a refused change and keeps a restored one in order', () => {
    const h = createUndoHistory()
    const a = h.push(entry('a'))
    const b = h.push(entry('b'))
    h.drop(b)
    expect(h.size()).toBe(1)
    h.push(entry('c'))
    const taken = h.take(a)!
    h.restore(taken)
    expect(h.take()?.label).toBe('c')
    expect(h.take()?.label).toBe('a')
  })

  it('keeps only the newest `limit` changes', () => {
    const h = createUndoHistory(2)
    h.push(entry('a'))
    h.push(entry('b'))
    h.push(entry('c'))
    expect(h.size()).toBe(2)
    expect(h.take()?.label).toBe('c')
    expect(h.take()?.label).toBe('b')
  })

  it('an undone change can be redone; a new change clears what could be redone', () => {
    const h = createUndoHistory()
    h.push(entry('a'))
    h.push(entry('b'))
    h.undone(h.take()!)
    expect(h.size()).toBe(1)
    const b = h.takeRedo()!
    expect(b.label).toBe('b')
    h.redone(b)
    expect(h.peek()?.label).toBe('b')
    h.undone(h.take()!)
    expect(h.redoSize()).toBe(1)
    h.push(entry('c'))
    expect(h.redoSize()).toBe(0)
  })
})
