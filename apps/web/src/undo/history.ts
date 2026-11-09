/**
 * The undo history behind Z / Ctrl+Z and redo (Ctrl+Shift+Z, Ctrl+Y): one entry per change made
 * from the tree, My Day or the detail panel's status, newest last. Each entry knows how to put its
 * change back (`revert`) and how to make it again (`reapply`). Entries are pushed as the change is
 * sent (so a quick Z after T undoes that T, not the change before it) and dropped again if the
 * server refuses the change. Undo and redo run through the same write queue, so they always come
 * after the change they act on. A new change clears what could be redone.
 */
export interface UndoEntry {
  id: number
  /** What the change did, in the past tense: "Scheduled 'Order coax' for today". */
  label: string
  /** Puts the change back. Called inside the write queue. */
  revert: () => Promise<unknown>
  /** Makes the change again (redo). Called inside the write queue. */
  reapply: () => Promise<unknown>
  /** Where to put the selection once reverted or reapplied. */
  select?: { pane: 'tree' | 'day'; id: string }
}

export type UndoInput = Omit<UndoEntry, 'id'>

/** Enough for a working session; older entries fall off. */
export const UNDO_LIMIT = 100

export interface UndoHistory {
  /** Adds a new change and forgets anything that could be redone; returns its id. */
  push(e: UndoInput): number
  /** Forgets a change (the server refused it, so there is nothing to undo). */
  drop(id: number): void
  /** Takes the newest change off the history, or the one with `id`. */
  take(id?: number): UndoEntry | undefined
  /** The newest change, left in place. */
  peek(): UndoEntry | undefined
  /** Puts back an entry whose revert failed, so Z can try it again. */
  restore(e: UndoEntry): void
  /** An undone change, now available to redo. */
  undone(e: UndoEntry): void
  /** Takes the most recently undone change, to redo it. */
  takeRedo(): UndoEntry | undefined
  /** A redone change, back on the history (what's left to redo stays). */
  redone(e: UndoEntry): void
  /** Puts back an entry whose redo failed, so it can be tried again. */
  restoreRedo(e: UndoEntry): void
  size(): number
  redoSize(): number
  clear(): void
}

export function createUndoHistory(limit = UNDO_LIMIT): UndoHistory {
  let seq = 0
  let entries: UndoEntry[] = []
  let redo: UndoEntry[] = []
  const add = (e: UndoEntry) => {
    entries.push(e)
    entries.sort((a, b) => a.id - b.id)
    if (entries.length > limit) entries = entries.slice(-limit)
  }
  return {
    push(e) {
      const entry = { ...e, id: ++seq }
      redo = []
      add(entry)
      return entry.id
    },
    drop(id) {
      entries = entries.filter((e) => e.id !== id)
    },
    take(id) {
      const i = id === undefined ? entries.length - 1 : entries.findIndex((e) => e.id === id)
      if (i < 0) return undefined
      const [entry] = entries.splice(i, 1)
      return entry
    },
    peek: () => entries.at(-1),
    restore: add,
    undone(e) {
      redo.push(e)
      if (redo.length > limit) redo = redo.slice(-limit)
    },
    takeRedo: () => redo.pop(),
    redone: add,
    restoreRedo(e) {
      redo.push(e)
    },
    size: () => entries.length,
    redoSize: () => redo.length,
    clear() {
      entries = []
      redo = []
    },
  }
}

/** The app's one history. */
export const undoHistory = createUndoHistory()

/**
 * Sends `apply` through `mutate` and records it with how to revert it; `apply` is also its redo,
 * unless `input.reapply` says otherwise (a create is redone by restoring the task, not a new one).
 * The record is dropped again if the write fails. Returns the write's own promise.
 */
export function recorded<T>(
  mutate: <R>(fn: () => Promise<R>) => Promise<R>,
  input: Omit<UndoInput, 'reapply'> & Partial<Pick<UndoInput, 'reapply'>>,
  apply: () => Promise<T>,
): Promise<T> {
  const write = mutate(apply)
  const id = undoHistory.push({ reapply: apply, ...input })
  return write.catch((e: unknown) => {
    undoHistory.drop(id)
    throw e
  })
}
