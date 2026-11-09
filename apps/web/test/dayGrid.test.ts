import { describe, expect, it } from 'vitest'
import { dayGrid } from '../src/picker/dayGrid'

describe('dayGrid', () => {
  it('puts today in the first row, Monday first', () => {
    const g = dayGrid('2026-11-11', 5) // a Wednesday
    expect(g).toHaveLength(5)
    expect(g.every((row) => row.length === 7)).toBe(true)
    expect(g[0]![0]!.date).toBe('2026-11-09') // that week's Monday
    expect(g[0]!.map((c) => c.date)).toContain('2026-11-11')
    expect(g[1]![0]!.date).toBe('2026-11-16')
    expect(g[4]![6]!.date).toBe('2026-12-13')
  })

  it('starts on today when today is a Monday', () => {
    expect(dayGrid('2026-11-09', 2)[0]![0]!.date).toBe('2026-11-09')
  })

  it('labels each cell with its month', () => {
    const g = dayGrid('2026-11-27', 2)
    expect(g.flat().find((c) => c.date === '2026-11-30')!.inMonthLabel).toBe('Nov')
    expect(g.flat().find((c) => c.date === '2026-12-01')!.inMonthLabel).toBe('Dec')
  })
})
