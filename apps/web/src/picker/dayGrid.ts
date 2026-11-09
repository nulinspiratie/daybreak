import { addDays, type ISODate, weekdayName } from '@daybreak/core/dates'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short month name of an ISO date: "Nov". */
export const monthShort = (date: ISODate): string => MONTHS[Number(date.slice(5, 7)) - 1]!

/**
 * `weeks` rows of seven days, Monday first, starting with the week that holds today. Cells before
 * today are part of the first row but cannot be picked.
 */
export function dayGrid(today: ISODate, weeks: number): { date: ISODate; inMonthLabel: string }[][] {
  const start = addDays(today, -WEEKDAYS.indexOf(weekdayName(today, 'short')))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d)
      return { date, inMonthLabel: monthShort(date) }
    }),
  )
}
