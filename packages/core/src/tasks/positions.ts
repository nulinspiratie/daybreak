import { generateKeyBetween } from 'fractional-indexing'
import { DaybreakError } from '../errors'
import type { Task } from '../types'

/**
 * A fractional key for inserting among `siblings` (already ordered).
 * With neither `afterId` nor `beforeId` the key goes at the end.
 */
export function positionFor(
  siblings: Task[],
  at: { afterId?: string; beforeId?: string },
  key: (t: Task) => string | null = (t) => t.position,
): string {
  let prev: Task | undefined
  let next: Task | undefined
  if (at.afterId !== undefined) {
    const i = siblings.findIndex((s) => s.id === at.afterId)
    if (i < 0) throw new DaybreakError('invalid', `#${at.afterId} is not among the siblings`)
    prev = siblings[i]
    next = siblings[i + 1]
  } else if (at.beforeId !== undefined) {
    const i = siblings.findIndex((s) => s.id === at.beforeId)
    if (i < 0) throw new DaybreakError('invalid', `#${at.beforeId} is not among the siblings`)
    next = siblings[i]
    prev = siblings[i - 1]
  } else {
    prev = siblings[siblings.length - 1]
  }
  return generateKeyBetween(prev ? key(prev) : null, next ? key(next) : null)
}
