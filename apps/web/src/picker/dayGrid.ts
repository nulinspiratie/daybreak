import { addDays, type ISODate, weekdayName } from '@daybreak/core/dates'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short month name of an ISO date: "Nov". */
export const monthShort = (date: ISODate): string => MONTHS[Number(date.slice(5, 7)) - 1]!

/** Days since Monday (0 to 6). */
function mondayOffset(date: ISODate): number {
  const i = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekdayName(date, 'short'))
  return i
}

/**
 * `weeks` rows of seven days, Monday first, starting with the week that holds today. Cells before
 * today are part of the first row but cannot be picked.
 */
export function dayGrid(today: ISODate, weeks: number): { date: ISODate; inMonthLabel: string }[][] {
  const start = addDays(today, -mondayOffset(today))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d)
      return { date, inMonthLabel: monthShort(date) }
    }),
  )
}
