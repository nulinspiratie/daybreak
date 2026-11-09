import { describe, expect, it, vi } from 'vitest'
import { createMutationQueue } from '../src/api/queue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mutation queue', () => {
  it('runs strictly in order even when earlier calls are slower', async () => {
    const q = createMutationQueue()
    const log: string[] = []
    let running = 0
    let overlap = false
    const delays = [30, 5, 20, 1, 10]
    const results = await Promise.all(
      delays.map((ms, i) =>
        q.enqueue(async () => {
          running++
          if (running > 1) overlap = true
          log.push(`start ${i}`)
          await sleep(ms + Math.random() * 5)
          log.push(`end ${i}`)
          running--
          return i
        }),
      ),
    )
    expect(results).toEqual([0, 1, 2, 3, 4])
    expect(log).toEqual(delays.flatMap((_, i) => [`start ${i}`, `end ${i}`]))
    expect(overlap).toBe(false)
  })

  it('a rejection does not stop later calls', async () => {
    const q = createMutationQueue()
    const failing = q.enqueue(async () => {
      throw new Error('boom')
    })
    const later = q.enqueue(async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    await expect(later).resolves.toBe('ok')
  })

  it('idle resolves after the last one', async () => {
    const q = createMutationQueue()
    await q.idle()
    let done = 0
    void q.enqueue(async () => { await sleep(10); done++ })
    void q.enqueue(async () => { await sleep(10); done++ })
    await q.idle()
    expect(done).toBe(2)
  })

  it('onDrain fires once after a burst', async () => {
    const q = createMutationQueue()
    let drains = 0
    q.onDrain(() => drains++)
    void q.enqueue(async () => sleep(5))
    void q.enqueue(async () => sleep(5))
    void q.enqueue(async () => sleep(5))
    await q.idle()
    expect(drains).toBe(1)
  })

  it('onDrain fires again after b when b is enqueued right after awaiting a', async () => {
    const q = createMutationQueue()
    const log: string[] = []
    q.onDrain(() => log.push('drain'))
    await q.enqueue(async () => { log.push('a') })
    const b = q.enqueue(async () => { await sleep(10); log.push('b') })
    await b
    await q.idle()
    expect(log).toEqual(['a', 'drain', 'b', 'drain'])
  })

  it('onDrain unsubscribe works', async () => {
    const q = createMutationQueue()
    let drains = 0
    const off = q.onDrain(() => drains++)
    await q.enqueue(async () => 1)
    await q.idle()
    off()
    await q.enqueue(async () => 2)
    await q.idle()
    expect(drains).toBe(1)
  })

  it('a throwing drain listener does not halt the queue or hide later listeners', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const q = createMutationQueue()
    const log: string[] = []
    q.onDrain(() => {
      log.push('bad')
      throw new Error('listener boom')
    })
    q.onDrain(() => log.push('good'))
    await q.enqueue(async () => 'a')
    await q.idle()
    await expect(q.enqueue(async () => 'b')).resolves.toBe('b')
    await q.idle()
    expect(log).toEqual(['bad', 'good', 'bad', 'good'])
    expect(err).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })

  it('onFailure hears each rejected write, before the drain, and not the successful ones', async () => {
    const q = createMutationQueue()
    const log: string[] = []
    const off = q.onFailure((e) => log.push(`fail ${(e as Error).message}`))
    q.onDrain(() => log.push('drain'))
    void q.enqueue(async () => 'ok')
    q.enqueue(async () => {
      throw new Error('boom')
    }).catch(() => log.push('caller'))
    await q.idle()
    expect(log).toEqual(['fail boom', 'drain', 'caller'])
    off()
    await q.enqueue(async () => {
      throw new Error('again')
    }).catch(() => {})
    expect(log).not.toContain('fail again')
  })
})
