/** Runs mutations strictly one at a time, in the order they were enqueued. */
export function createMutationQueue(): {
  enqueue<T>(fn: () => Promise<T>): Promise<T>
  idle(): Promise<void>
} {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  let waiters: Array<() => void> = []

  const settle = () => {
    pending--
    if (pending === 0) {
      const ws = waiters
      waiters = []
      for (const w of ws) w()
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
  }
}
