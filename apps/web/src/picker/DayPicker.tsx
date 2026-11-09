import { addDays, daysBetween, type ISODate, parseDayInput, weekdayName } from '@daybreak/core/dates'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useDayCounts } from '../api/hooks'
import { dayGrid, monthShort } from './dayGrid'

/** Four weeks and a bit: the quick list covers 9 days, the calendar a month ahead. */
export const GRID_WEEKS = 5
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

const dayNum = (date: ISODate) => Number(date.slice(8, 10))
const short = (date: ISODate) => `${weekdayName(date, 'short')} ${dayNum(date)}`
const dots = (n: number) => '•'.repeat(Math.min(n, 4))
const tasks = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

function longLabel(date: ISODate, today: ISODate): string {
  const off = daysBetween(today, date)
  if (off === 0) return `Today · ${short(date)}`
  if (off === 1) return `Tomorrow · ${short(date)}`
  return `${short(date)} ${monthShort(date)}`
}

export interface DayPickerProps {
  today: ISODate
  /** The task's current day; the highlight starts there if the grid has it. */
  initial?: ISODate | null
  /** Shows the "No day" button (the tree's version). */
  allowNoDay: boolean
  onPick: (date: ISODate | null) => void
  onClose: () => void
}

/**
 * The day picker: a quick list for 1 to 9, a calendar from this week, and a text field ("fri",
 * "20 nov"). It has no position of its own; the main window floats it (PickerHost), the review
 * puts it inline. Its input takes focus and owns the keys while it is open.
 */
export function DayPicker({ today, initial, allowNoDay, onPick, onClose }: DayPickerProps) {
  const grid = useMemo(() => dayGrid(today, GRID_WEEKS), [today])
  const last = grid[grid.length - 1]![6]!.date
  const inGrid = (d: ISODate) => d >= today && d <= last
  const [text, setText] = useState('')
  const [highlight, setHighlight] = useState<ISODate>(initial && inGrid(initial) ? initial : today)
  const inputRef = useRef<HTMLInputElement>(null)
  const counts = useDayCounts(today, last).data ?? {}

  useEffect(() => inputRef.current?.focus(), [])

  const typed = text.trim() === '' ? null : parseDayInput(text, today)
  // A day before today is not offered anywhere, so typing one does not count as a day.
  const parsed = typed !== null && typed >= today ? typed : null
  const outside = parsed !== null && !inGrid(parsed)

  const onText = (value: string) => {
    setText(value)
    const d = value.trim() === '' ? null : parseDayInput(value, today)
    if (d !== null && inGrid(d) && d >= today) setHighlight(d)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey) return
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Escape') {
      handled()
      return onClose()
    }
    if (e.key === 'Enter') {
      if (e.target instanceof HTMLButtonElement) return // a focused button keeps its own Enter
      handled()
      if (text.trim() === '') return onPick(highlight)
      if (parsed !== null) onPick(parsed)
      return
    }
    // Digits pick only while nothing is typed, so "20 nov" can be entered.
    if (/^[1-9]$/.test(e.key) && text === '') {
      handled()
      return onPick(addDays(today, Number(e.key) - 1))
    }
    const step = MOVES[e.key]
    if (step === undefined) return
    // With text in the field, ← and → move the caret instead.
    if (text !== '' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
    handled()
    const next = addDays(highlight, step)
    setHighlight(next < today ? today : next > last ? last : next)
  }

  const quick = Array.from({ length: 9 }, (_, i) => addDays(today, i))
  const month = (() => {
    const [y, m] = highlight.split('-')
    return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1]} ${y}`
  })()

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keys from the input and buttons bubble to this one handler
    <div className="picker" onKeyDown={onKeyDown}>
      <div className="picker__quick">
        <span className="picker__cap">Next 9 days</span>
        {quick.map((d, i) => (
          <button
            key={d}
            type="button"
            className={`picker__q${d === highlight ? ' is-on' : ''}`}
            onClick={() => onPick(d)}
            onMouseEnter={() => setHighlight(d)}
            tabIndex={-1}
          >
            <span className="picker__qkey">{i + 1}</span>
            <span className="picker__qlabel">{longLabel(d, today)}</span>
            <span className="picker__load" aria-label={tasks(counts[d] ?? 0)}>
              {dots(counts[d] ?? 0)}
            </span>
          </button>
        ))}
      </div>
      <div className="picker__cal">
        <div className="picker__bar">
          <input
            ref={inputRef}
            className="picker__input"
            type="text"
            value={text}
            placeholder="Type a day: fri, tomorrow, 20 nov"
            aria-label="Day"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onText(e.target.value)}
          />
          {allowNoDay && (
            <button type="button" className="picker__none" onClick={() => onPick(null)} tabIndex={-1}>
              No day
            </button>
          )}
        </div>
        <div className="picker__head">
          <span className="picker__month">{month}</span>
          {outside && parsed !== null ? (
            <span className="picker__parsed" role="status">
              Enter picks {short(parsed)} {monthShort(parsed)}
            </span>
          ) : (
            <span className="picker__hint">← → day · ↑ ↓ week · Enter</span>
          )}
        </div>
        <div className="picker__grid" role="grid" aria-label="Days">
          {WEEKDAYS.map((w) => (
            <span key={w} className="picker__wd">
              {w}
            </span>
          ))}
          {grid.flat().map(({ date, inMonthLabel }) => {
            const off = daysBetween(today, date)
            const past = off < 0
            const n = counts[date] ?? 0
            const wd = weekdayName(date, 'short')
            const cls = [
              'picker__day',
              date === highlight && 'is-on',
              off === 0 && 'is-today',
              past && 'is-past',
              (wd === 'Sat' || wd === 'Sun') && 'is-weekend',
              date.slice(5, 7) !== highlight.slice(5, 7) && 'is-other',
            ]
            return (
              <button
                key={date}
                type="button"
                className={cls.filter(Boolean).join(' ')}
                aria-label={`${longLabel(date, today)}${n > 0 ? `, ${tasks(n)}` : ''}`}
                aria-current={off === 0 ? 'date' : undefined}
                disabled={past}
                tabIndex={-1}
                onClick={() => onPick(date)}
              >
                {off >= 0 && off <= 8 && <span className="picker__dkey">{off + 1}</span>}
                <span className="picker__num">{dayNum(date) === 1 ? `1 ${inMonthLabel}` : dayNum(date)}</span>
                <span className="picker__dots" aria-hidden="true">
                  {dots(n)}
                </span>
              </button>
            )
          })}
        </div>
        <span className="picker__foot">1–9 = today … 8 days out. Dots = tasks already on that day. Esc closes.</span>
      </div>
    </div>
  )
}
