import type { ReviewItem, ReviewView } from '@daybreak/core'
import type { KeyLike } from '../keyboard/keymap'

export type ReviewCommand = 'today' | 'day' | 'backlog' | 'cancel' | 'undo' | 'start'

const LETTERS: Record<string, ReviewCommand> = { t: 'today', d: 'day', b: 'backlog', x: 'cancel', z: 'undo' }

/**
 * The review's keys: T today, D another day, B backlog (not today), X cancel, Z undo, and Space
 * to start the day once everything is sorted. While the day picker is open it owns every key.
 * Esc means nothing here: the review does not close.
 */
export function resolveReviewKey(e: KeyLike, ctx: { pickerOpen: boolean; allSorted: boolean }): ReviewCommand | null {
  if (ctx.pickerOpen || e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.key === ' ') return ctx.allSorted ? 'start' : null
  return (e.key.length === 1 && LETTERS[e.key.toLowerCase()]) || null
}

/** The item waiting for a decision: the first undecided leftover, then the first undecided suggestion. */
export function currentItem(view: ReviewView): ReviewItem | null {
  const open = (i: ReviewItem) => i.decision === null
  return view.leftovers.find(open) ?? view.suggestions.find(open) ?? null
}

type Decision = NonNullable<ReviewItem['decision']>

function withItem(view: ReviewView, taskId: string, decision: Decision | null): ReviewView {
  const set = (list: ReviewItem[]) => list.map((i) => (i.task.id === taskId ? { ...i, decision } : i))
  return { ...view, leftovers: set(view.leftovers), suggestions: set(view.suggestions) }
}

/** The view as it will be once the server has applied `decision` to `taskId` (shown while the post is queued). */
export function applyDecision(view: ReviewView, taskId: string, decision: Decision): ReviewView {
  return {
    ...withItem(view, taskId, decision),
    sortedCount: view.sortedCount + 1,
    todayCount: view.todayCount + (decision.choice === 'today' ? 1 : 0),
  }
}

/**
 * The view with its latest decision reverted, as undo will do. Decided items lead their group in
 * decision order and the review goes leftovers first, so the latest is the last decided
 * suggestion, else the last decided leftover. The server's answer replaces this guess.
 */
export function undoLast(view: ReviewView): ReviewView {
  const last = (list: ReviewItem[]) => list.findLast((i) => i.decision !== null)
  const item = last(view.suggestions) ?? last(view.leftovers)
  if (!item) return view
  return {
    ...withItem(view, item.task.id, null),
    sortedCount: view.sortedCount - 1,
    todayCount: view.todayCount - (item.decision?.choice === 'today' ? 1 : 0),
  }
}
