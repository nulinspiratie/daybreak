import { describe, expect, it, vi } from 'vitest'
import { createRolloverTick } from '../src/rollover'
import { ChangeBroker } from '../src/sse'
import { testApp } from './helpers'

describe('rollover', () => {
  it('publishes day_changed once when the fixed clock crosses 04:00', async () => {
    const { daybreak, clock } = await testApp({ now: '2026-11-10T02:50:00Z' })
    const broker = new ChangeBroker()
    const seen: Array<[string, object]> = []
    broker.subscribe((e, data) => seen.push([e, data]))
    const tick = createRolloverTick(daybreak, broker)
    expect(daybreak.today()).toBe('2026-11-09')
    tick()
    expect(seen).toEqual([])
    clock.set('2026-11-10T03:10:00Z')
    tick()
    tick()
    expect(seen.filter(([e]) => e === 'day_changed')).toEqual([
      ['day_changed', { today: '2026-11-10' }],
    ])
  })

  it('publishes each change once when two day starts were crossed', async () => {
    const { daybreak, clock } = await testApp({ now: '2026-11-10T02:50:00Z' })
    const broker = new ChangeBroker()
    const seen: object[] = []
    broker.subscribe((e, data) => {
      if (e === 'day_changed') seen.push(data)
    })
    const tick = createRolloverTick(daybreak, broker)
    clock.set('2026-11-10T03:10:00Z')
    tick()
    clock.set('2026-11-11T03:10:00Z')
    tick()
    expect(seen).toEqual([{ today: '2026-11-10' }, { today: '2026-11-11' }])
  })

  it('auto-finishes an empty review on the new day', async () => {
    const { daybreak, clock } = await testApp({ now: '2026-11-10T02:50:00Z' })
    const tick = createRolloverTick(daybreak, new ChangeBroker())
    clock.set('2026-11-10T03:10:00Z')
    tick()
    expect(daybreak.needsReview()).toBe(false)
  })

  it('survives autoFinishEmptyReview throwing and still publishes day_changed once', async () => {
    const { daybreak, clock } = await testApp({ now: '2026-11-10T02:50:00Z' })
    const broker = new ChangeBroker()
    const seen: object[] = []
    broker.subscribe((e, data) => {
      if (e === 'day_changed') seen.push(data)
    })
    vi.spyOn(daybreak, 'autoFinishEmptyReview').mockImplementation(() => {
      throw new Error('database is locked')
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tick = createRolloverTick(daybreak, broker)
    clock.set('2026-11-10T03:10:00Z')
    expect(() => tick()).not.toThrow()
    tick()
    expect(seen).toEqual([{ today: '2026-11-10' }])
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})
