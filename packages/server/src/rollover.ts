import type { Daybreak } from '@daybreak/core'
import type { ChangeBroker } from './sse'

/** One check of the day; publishes `day_changed` once per change of `d.today()`. */
export function createRolloverTick(d: Daybreak, broker: ChangeBroker): () => void {
  let last = d.today()
  return () => {
    try {
      const today = d.today()
      if (today === last) return
      try {
        d.autoFinishEmptyReview()
      } catch (e) {
        console.error(`Daybreak: auto-finishing the review failed: ${(e as Error).message}`)
      }
      broker.publish('day_changed', { today })
      last = today
    } catch (e) {
      console.error(`Daybreak: day rollover check failed: ${(e as Error).message}`)
    }
  }
}

export function startRollover(d: Daybreak, broker: ChangeBroker, intervalMs = 30_000): () => void {
  const timer = setInterval(createRolloverTick(d, broker), intervalMs)
  return () => clearInterval(timer)
}
