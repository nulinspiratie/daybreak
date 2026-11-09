// Pure date helpers. No Node or Bun imports: this module is also used in the browser.

export type ISODate = string

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function format(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y!, m!, d!]
}

/** Local noon avoids DST edges. */
function noon(date: ISODate): Date {
  const [y, m, d] = parts(date)
  return new Date(y, m - 1, d, 12)
}

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d, 12)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** The local calendar date, or the one before while the wall clock is still earlier than `dayStartsAt` (HH:MM). */
export function localDate(now: Date, dayStartsAt: string): ISODate {
  const [hh, mm] = dayStartsAt.split(':').map(Number)
  const date = format(now.getFullYear(), now.getMonth() + 1, now.getDate())
  // Wall-clock minutes, not elapsed time: on DST nights the day still starts at dayStartsAt.
  const early = now.getHours() * 60 + now.getMinutes() < (hh ?? 0) * 60 + (mm ?? 0)
  return early ? addDays(date, -1) : date
}

export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = parts(date)
  const dt = new Date(y, m - 1, d + n, 12)
  return format(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000)
}

export function weekdayName(date: ISODate, style: 'long' | 'short'): string {
  const name = WEEKDAYS[noon(date).getDay()]!
  return style === 'long' ? name : name.slice(0, 3)
}

function shortDate(date: ISODate): string {
  const [, m, d] = parts(date)
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)}`
}

export function dayLabel(
  date: ISODate,
  today: ISODate,
): { text: string; kind: 'overdue' | 'today' | 'week' | 'later'; fade: number } {
  const days = daysBetween(today, date)
  if (days < 0) return { text: shortDate(date), kind: 'overdue', fade: 0 }
  if (days === 0) return { text: 'Today', kind: 'today', fade: 0 }
  const fade = Math.min(1, Math.max(0, (days - 1) / 13))
  if (days <= 6) return { text: weekdayName(date, 'short'), kind: 'week', fade }
  return { text: shortDate(date), kind: 'later', fade }
}

function prefixIndex(word: string, names: string[], min: number): number {
  if (word.length < min) return -1
  return names.findIndex((n) => n.toLowerCase().startsWith(word))
}

export function parseDayInput(input: string, today: ISODate): ISODate | null {
  const text = input.trim().toLowerCase()
  if (!text) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    return validDate(y!, m!, d!) ? text : null
  }

  const tokens = text.split(/\s+/)
  if (tokens.length === 1) {
    const w = tokens[0]!
    if (w === 'today') return today
    if (w.length >= 3 && 'tomorrow'.startsWith(w)) return addDays(today, 1)
    const wd = prefixIndex(w, WEEKDAYS, 3)
    if (wd >= 0) {
      const delta = ((wd - noon(today).getDay() + 6) % 7) + 1
      return addDays(today, delta)
    }
    return null
  }

  if (tokens.length === 2) {
    let monthTok: string
    let dayTok: string
    if (/^\d{1,2}$/.test(tokens[0]!)) [dayTok, monthTok] = [tokens[0]!, tokens[1]!]
    else [monthTok, dayTok] = [tokens[0]!, tokens[1]!]
    if (!/^\d{1,2}$/.test(dayTok)) return null
    const month = prefixIndex(monthTok, MONTHS, 3) + 1
    if (month === 0) return null
    const day = Number(dayTok)
    const [ty] = parts(today)
    if (validDate(ty, month, day)) {
      const candidate = format(ty, month, day)
      if (candidate >= today) return candidate
    } else if (!validDate(ty + 1, month, day)) {
      return null
    }
    return validDate(ty + 1, month, day) ? format(ty + 1, month, day) : null
  }
  return null
}
