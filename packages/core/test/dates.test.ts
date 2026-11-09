import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayLabel,
  daysBetween,
  fixedClock,
  localDate,
  parseDayInput,
  systemClock,
  weekdayName,
} from '../src/index'

describe('clock', () => {
  it('fixedClock returns and updates its time', () => {
    const c = fixedClock('2026-11-10T08:00:00Z')
    expect(c.now().toISOString()).toBe('2026-11-10T08:00:00.000Z')
    c.set('2026-11-11T09:00:00Z')
    expect(c.now().toISOString()).toBe('2026-11-11T09:00:00.000Z')
  })
  it('systemClock returns a Date', () => {
    expect(systemClock.now()).toBeInstanceOf(Date)
  })
})

describe('localDate', () => {
  it('stays on the previous day before the day start', () => {
    expect(localDate(new Date('2026-11-10T00:30:00Z'), '04:00')).toBe('2026-11-09')
  })
  it('rolls over after the day start', () => {
    expect(localDate(new Date('2026-11-10T03:30:00Z'), '04:00')).toBe('2026-11-10')
  })
  it('uses midnight when dayStartsAt is 00:00', () => {
    expect(localDate(new Date('2026-11-09T23:30:00Z'), '00:00')).toBe('2026-11-10')
  })
  // Vitest pins TZ=Europe/Copenhagen. dayStartsAt is local wall-clock time, also on DST nights.
  it('starts the day at 04:00 local on the spring-forward night (2026-03-29)', () => {
    expect(localDate(new Date('2026-03-29T01:59:00Z'), '04:00')).toBe('2026-03-28') // 03:59 CEST
    expect(localDate(new Date('2026-03-29T02:01:00Z'), '04:00')).toBe('2026-03-29') // 04:01 CEST
  })
  it('starts the day at 04:00 local on the fall-back night (2026-10-25)', () => {
    expect(localDate(new Date('2026-10-25T02:30:00Z'), '04:00')).toBe('2026-10-24') // 03:30 CET
    expect(localDate(new Date('2026-10-25T02:59:00Z'), '04:00')).toBe('2026-10-24') // 03:59 CET
    expect(localDate(new Date('2026-10-25T03:00:00Z'), '04:00')).toBe('2026-10-25') // 04:00 CET
  })
  it('compares minutes too', () => {
    expect(localDate(new Date('2026-11-10T03:29:00Z'), '04:30')).toBe('2026-11-09') // 04:29 local
    expect(localDate(new Date('2026-11-10T03:30:00Z'), '04:30')).toBe('2026-11-10') // 04:30 local
  })
})

describe('addDays / daysBetween / weekdayName', () => {
  it('adds days across DST and year edges', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-10', -1)).toBe('2026-11-09')
  })
  it('counts whole days', () => {
    expect(daysBetween('2026-11-06', '2026-11-10')).toBe(4)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-11-10', '2026-11-06')).toBe(-4)
  })
  it('names weekdays', () => {
    expect(weekdayName('2026-11-10', 'long')).toBe('Tuesday')
    expect(weekdayName('2026-11-09', 'short')).toBe('Mon')
  })
})

describe('dayLabel', () => {
  const today = '2026-11-10'
  it('labels overdue, today, week and later', () => {
    expect(dayLabel('2026-11-06', today)).toMatchObject({ text: '6 Nov', kind: 'overdue', fade: 0 })
    expect(dayLabel('2026-11-10', today)).toMatchObject({ text: 'Today', kind: 'today', fade: 0 })
    expect(dayLabel('2026-11-11', today)).toMatchObject({ text: 'Wed', kind: 'week', fade: 0 })
    expect(dayLabel('2026-11-16', today)).toMatchObject({ text: 'Mon', kind: 'week' })
    expect(dayLabel('2026-11-17', today)).toMatchObject({ text: '17 Nov', kind: 'later' })
  })
  it('fades with distance', () => {
    expect(dayLabel('2026-11-11', today).fade).toBe(0)
    expect(dayLabel('2026-11-24', today).fade).toBe(1)
    expect(dayLabel('2026-12-10', today).fade).toBe(1)
    expect(dayLabel('2026-11-17', today).fade).toBeCloseTo(6 / 13)
  })
})

describe('parseDayInput', () => {
  const today = '2026-11-10'
  const p = (s: string) => parseDayInput(s, today)
  it('parses relative words', () => {
    expect(p('today')).toBe('2026-11-10')
    expect(p('tomorrow')).toBe('2026-11-11')
    expect(p('tom')).toBe('2026-11-11')
  })
  it('parses weekdays as the next occurrence, never today', () => {
    expect(p('fri')).toBe('2026-11-13')
    expect(p('friday')).toBe('2026-11-13')
    expect(p('frid')).toBe('2026-11-13')
    expect(p('tue')).toBe('2026-11-17')
  })
  it('parses day and month in either order', () => {
    expect(p('nov 20')).toBe('2026-11-20')
    expect(p('20 nov')).toBe('2026-11-20')
    expect(p('20 november')).toBe('2026-11-20')
    expect(p('nov 10')).toBe('2026-11-10')
  })
  it('rolls past dates to next year', () => {
    expect(p('jan 5')).toBe('2027-01-05')
    expect(p('nov 9')).toBe('2027-11-09')
  })
  it('passes ISO dates through', () => {
    expect(p('2026-12-01')).toBe('2026-12-01')
  })
  it('is case-insensitive and tolerant of whitespace', () => {
    expect(p('  FRI ')).toBe('2026-11-13')
    expect(p('Nov 20')).toBe('2026-11-20')
  })
  it('rejects invalid input', () => {
    expect(p('')).toBeNull()
    expect(p('blah')).toBeNull()
    expect(p('feb 30')).toBeNull()
    expect(p('2026-02-30')).toBeNull()
    expect(p('fr')).toBeNull()
  })
})
