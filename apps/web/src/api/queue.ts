/** Runs mutations strictly one at a time, in the order they were enqueued. */
export function createMutationQueue(): {
  enqueue<T>(fn: () => Promise<T>): Promise<T>
  idle(): Promise<void>
  /** Calls cb each time the queue goes from busy to empty. Returns an unsubscribe. */
  onDrain(cb: () => void): () => void
} {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  let waiters: Array<() => void> = []
  const drainListeners = new Set<() => void>()

  const settle = () => {
    pending--
    if (pending === 0) {
      const ws = waiters
      waiters = []
      for (const w of ws) w()
      for (const cb of [...drainListeners]) {
        // A throwing listener must not reject `tail`, which would halt the queue.
        try {
          cb()
        } catch (e) {
          console.error('mutation queue: drain listener threw', e)
        }
      }
    }
  }

  return {
    enqueue<T>(fn: () => Promise<T>): Promise<T> {
      pending++
      const result = tail.then(fn)
      // Keep the chain alive after a rejection; the caller still sees it.
      tail = result.then(settle, settle)
      return result
    },
    idle(): Promise<void> {
      if (pending === 0) return Promise.resolve()
      return new Promise((resolve) => waiters.push(resolve))
    },
    onDrain(cb: () => void): () => void {
      drainListeners.add(cb)
      return () => {
        drainListeners.delete(cb)
      }
    },
  }
}
