/**
 * The undo history behind Z (and Ctrl+Z): one entry per change made from the tree, My Day or the
 * detail panel's status, newest last. Each entry knows how to put its change back. Entries are
 * pushed as the change is sent (so a quick Z after T undoes that T, not the change before it) and
 * dropped again if the server refuses the change. Undo runs through the same write queue, so it
 * always comes after the change it reverts.
 */
export interface UndoEntry {
  id: number
  /** What the change did, in the past tense: "Scheduled 'Order coax' for today". */
  label: string
  /** Puts the change back. Called inside the write queue. */
  revert: () => Promise<unknown>
  /** Where to put the selection once reverted. */
  select?: { pane: 'tree' | 'day'; id: string }
}

export type UndoInput = Omit<UndoEntry, 'id'>

/** Enough for a working session; older entries fall off. */
export const UNDO_LIMIT = 100

export interface UndoHistory {
  /** Adds a change; returns its id. */
  push(e: UndoInput): number
  /** Forgets a change (the server refused it, so there is nothing to undo). */
  drop(id: number): void
  /** Takes the newest change off the history, or the one with `id`. */
  take(id?: number): UndoEntry | undefined
  /** The newest change, left in place. */
  peek(): UndoEntry | undefined
  /** Puts back an entry whose revert failed, so Z can try it again. */
  restore(e: UndoEntry): void
  size(): number
  clear(): void
}

export function createUndoHistory(limit = UNDO_LIMIT): UndoHistory {
  let seq = 0
  let entries: UndoEntry[] = []
  return {
    push(e) {
      const entry = { ...e, id: ++seq }
      entries.push(entry)
      if (entries.length > limit) entries = entries.slice(-limit)
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
    restore(e) {
      entries.push(e)
      entries.sort((a, b) => a.id - b.id)
    },
    size: () => entries.length,
    clear() {
      entries = []
    },
  }
}

/** The app's one history. */
export const undoHistory = createUndoHistory()

/**
 * Records `input` for the change `write` is making, and forgets it again if the write fails.
 * Returns the write's own promise.
 */
export function recorded<T>(input: UndoInput, write: Promise<T>): Promise<T> {
  const id = undoHistory.push(input)
  return write.catch((e: unknown) => {
    undoHistory.drop(id)
    throw e
  })
}
