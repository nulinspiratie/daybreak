import type { ReviewItem, ReviewView } from '@daybreak/core'
import type { KeyLike } from '../keyboard/keymap'

export type ReviewCommand =
  | 'today'
  | 'day'
  | 'backlog'
  | 'cancel'
  | 'done'
  | 'undo'
  | 'start'
  | 'up'
  | 'down'

const LETTERS: Record<string, ReviewCommand> = {
  t: 'today',
  d: 'day',
  b: 'backlog',
  x: 'cancel',
  z: 'undo',
}

/**
 * The review's keys: T today, D another day, B backlog (not today), X cancel, Space done, Z undo,
 * ↑↓ to move between items (decided ones too, to change them). On the end row Space starts the
 * day once everything is sorted. While the day picker is open it owns every key. Esc means
 * nothing here: the review does not close.
 */
export function resolveReviewKey(
  e: KeyLike,
  ctx: { pickerOpen: boolean; allSorted: boolean; onItem: boolean },
): ReviewCommand | null {
  if (ctx.pickerOpen || e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.key === 'ArrowUp') return 'up'
  if (e.key === 'ArrowDown') return 'down'
  if (e.key === ' ') return ctx.onItem ? 'done' : ctx.allSorted ? 'start' : null
  return (e.key.length === 1 && LETTERS[e.key.toLowerCase()]) || null
}

/** Where the review's cursor is: on an item (its task id) or on the end row. */
export type Spot = string | 'end'
export const END: Spot = 'end'

/** Every item, top to bottom: leftovers, then suggestions. */
export function allItems(view: ReviewView): ReviewItem[] {
  return [...view.leftovers, ...view.suggestions]
}

/** The item waiting for a decision: the first undecided leftover, then the first undecided suggestion. */
export function currentItem(view: ReviewView): ReviewItem | null {
  return allItems(view).find((i) => i.decision === null) ?? null
}

/** The cursor's spot in `view`: `chosen` while it is still in the list, else the first undecided item, else the end row. */
export function spotIn(view: ReviewView, chosen: Spot | null): Spot {
  if (chosen === END) return END
  if (chosen !== null && allItems(view).some((i) => i.task.id === chosen)) return chosen
  return currentItem(view)?.task.id ?? END
}

/** One step up or down the list, the end row last. */
export function step(view: ReviewView, from: Spot, by: 1 | -1): Spot {
  const spots: Spot[] = [...allItems(view).map((i) => i.task.id), END]
  const at = spots.indexOf(from)
  return spots[Math.min(spots.length - 1, Math.max(0, (at === -1 ? 0 : at) + by))]!
}

/** Where the cursor goes after deciding `taskId`: the next undecided item below it, else the first above, else the end row. */
export function afterDecision(view: ReviewView, taskId: string): Spot {
  const items = allItems(view)
  const at = items.findIndex((i) => i.task.id === taskId)
  const open = (i: ReviewItem) => i.decision === null
  return (items.slice(at + 1).find(open) ?? items.find(open))?.task.id ?? END
}

type Decision = NonNullable<ReviewItem['decision']>

function withItem(view: ReviewView, taskId: string, decision: Decision | null): ReviewView {
  const set = (list: ReviewItem[]) =>
    list.map((i) => (i.task.id === taskId ? { ...i, decision } : i))
  return { ...view, leftovers: set(view.leftovers), suggestions: set(view.suggestions) }
}

const isToday = (d: Decision | null | undefined) => (d?.choice === 'today' ? 1 : 0)

/**
 * The view as it will be once the server has applied `decision` to `taskId` (shown while the post
 * is queued). A decided item can be decided again: the server undoes the old choice first.
 */
export function applyDecision(
  view: ReviewView,
  taskId: string,
  decision: Omit<Decision, 'seq'>,
): ReviewView {
  const items = allItems(view)
  const was = items.find((i) => i.task.id === taskId)?.decision ?? null
  const seq = Math.max(0, ...items.map((i) => i.decision?.seq ?? 0)) + 1
  const next = { ...decision, seq }
  return {
    ...withItem(view, taskId, next),
    sortedCount: view.sortedCount + (was ? 0 : 1),
    todayCount: view.todayCount - isToday(was) + isToday(next),
  }
}

/** The item Z undoes next: the latest decision, by the server's `seq`. */
export function lastDecided(view: ReviewView): ReviewItem | null {
  let last: ReviewItem | null = null
  for (const i of allItems(view))
    if (i.decision && (!last || i.decision.seq > last.decision!.seq)) last = i
  return last
}

/**
 * The view with its latest decision reverted, as undo will do. After a changed decision the item
 * is left undecided (the server undid the old choice when it applied the new one). The server's
 * answer replaces this guess.
 */
export function undoLast(view: ReviewView): ReviewView {
  const item = lastDecided(view)
  if (!item) return view
  return {
    ...withItem(view, item.task.id, null),
    sortedCount: view.sortedCount - 1,
    todayCount: view.todayCount - isToday(item.decision),
  }
}
