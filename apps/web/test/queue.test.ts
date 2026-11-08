import { describe, expect, it } from 'vitest'
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
})
