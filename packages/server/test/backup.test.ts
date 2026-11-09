import type { BackupResult } from '@daybreak/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackupSchedule } from '../src/backup'

const HOUR = 60 * 60_000
const T0 = Date.parse('2026-11-10T08:00:00Z')

function setup() {
  let now = T0
  let day = '2026-11-10'
  let failure: string | null = null
  const runs: number[] = []
  const statusChanges: number[] = []
  const schedule = createBackupSchedule({
    dir: '/backups',
    now: () => now,
    today: () => day,
    run: (): BackupResult => {
      runs.push(now)
      if (failure) throw new Error(failure)
      return { date: day, file: `/backups/daybreak-${day}.db`, logsCopied: 0, pruned: [] }
    },
    onStatusChange: () => statusChanges.push(now),
  })
  return {
    schedule,
    runs,
    statusChanges,
    advance: (ms: number) => {
      now += ms
    },
    setDay: (d: string) => {
      day = d
    },
    fail: (message: string | null) => {
      failure = message
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('backup schedule', () => {
  it('backs up on the first check, then not again while nothing changes', () => {
    const t = setup()
    t.schedule.tick()
    expect(t.runs).toEqual([T0])
    t.advance(5 * HOUR)
    t.schedule.tick()
    expect(t.runs).toHaveLength(1)
    expect(t.schedule.status()).toEqual({
      dir: '/backups',
      lastAt: '2026-11-10T08:00:00.000Z',
      error: null,
    })
  })

  it('after a change, backs up again once an hour has passed since the last copy', () => {
    const t = setup()
    t.schedule.tick()
    t.schedule.markDirty()
    t.advance(HOUR - 60_000)
    t.schedule.tick()
    expect(t.runs).toHaveLength(1)
    t.advance(60_000)
    t.schedule.tick()
    expect(t.runs).toHaveLength(2)
    t.advance(HOUR)
    t.schedule.tick() // nothing changed since
    expect(t.runs).toHaveLength(2)
  })

  it('backs up at once on a new day, changes or not', () => {
    const t = setup()
    t.schedule.tick()
    t.advance(60_000)
    t.setDay('2026-11-11')
    t.schedule.tick()
    expect(t.runs).toHaveLength(2)
  })

  it('a failure is reported, never thrown, retried hourly, and cleared by a success', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = setup()
    t.fail("The backup folder X doesn't exist")
    expect(() => t.schedule.tick()).not.toThrow()
    expect(t.schedule.status()).toEqual({
      dir: '/backups',
      lastAt: null,
      error: "The backup folder X doesn't exist",
    })
    expect(t.statusChanges).toHaveLength(1)
    t.advance(30 * 60_000)
    t.schedule.tick()
    expect(t.runs).toHaveLength(1)
    t.advance(30 * 60_000)
    t.schedule.tick() // still failing: no new status change
    expect(t.runs).toHaveLength(2)
    expect(t.statusChanges).toHaveLength(1)
    t.fail(null)
    t.advance(HOUR)
    t.schedule.tick()
    expect(t.runs).toHaveLength(3)
    expect(t.schedule.status().error).toBeNull()
    expect(t.schedule.status().lastAt).toBe(new Date(T0 + 2 * HOUR).toISOString())
    expect(t.statusChanges).toHaveLength(2)
  })

  it('a failed run keeps the changes pending', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = setup()
    t.schedule.tick()
    t.schedule.markDirty()
    t.fail('disk full')
    t.advance(HOUR)
    t.schedule.tick()
    t.fail(null)
    t.advance(HOUR)
    t.schedule.tick()
    expect(t.runs).toHaveLength(3)
  })
})
