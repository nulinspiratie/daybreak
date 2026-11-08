import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

export type BrokerEvent = 'changed' | 'day_changed'
export type BrokerListener = (event: BrokerEvent, data: object) => void

export const PING_INTERVAL_MS = 25_000

export class ChangeBroker {
  private listeners = new Set<BrokerListener>()

  get listenerCount(): number {
    return this.listeners.size
  }

  subscribe(fn: BrokerListener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  publish(event: BrokerEvent, data: object = {}): void {
    for (const fn of [...this.listeners]) fn(event, data)
  }
}

export function eventRoutes(broker: ChangeBroker): Hono {
  const app = new Hono()
  app.get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = broker.subscribe((event, data) => {
        void stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {})
      })
      const ping = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => {})
      }, PING_INTERVAL_MS)
      const closed = new Promise<void>((resolve) => {
        const done = () => {
          clearInterval(ping)
          unsubscribe()
          resolve()
        }
        stream.onAbort(done)
        if (c.req.raw.signal.aborted) done()
        else c.req.raw.signal.addEventListener('abort', done, { once: true })
      })
      await closed
    }),
  )
  return app
}
