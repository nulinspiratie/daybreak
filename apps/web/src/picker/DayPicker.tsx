import {
  addDays,
  daysBetween,
  type ISODate,
  parseDayInput,
  weekdayName,
} from '@daybreak/core/dates'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useDayCounts } from '../api/hooks'
import { dayGrid, MONTH_NAMES, monthShort, WEEKDAYS } from './dayGrid'

/** Four weeks and a bit: the quick list covers 9 days, the calendar a month ahead. */
export const GRID_WEEKS = 5
/** A 1 to 9 key on an empty field is a quick pick that commits after this long, unless more is typed (R31). */
export const QUICK_PICK_MS = 400
/** Up to this many tasks on a day show as dots; more show the number. */
const MAX_DOTS = 4
const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

const dayNum = (date: ISODate) => Number(date.slice(8, 10))
const short = (date: ISODate) => `${weekdayName(date, 'short')} ${dayNum(date)}`
const load = (n: number) => (n <= MAX_DOTS ? '•'.repeat(n) : String(n))
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
  /** How long a quick-pick digit waits for another character. */
  quickPickMs?: number
}

/**
 * The day picker: a quick list for 1 to 9, a calendar from this week, and a text field ("fri",
 * "20 nov"). It has no position of its own; the main window floats it (PickerHost), the review
 * puts it inline. Its input takes focus and owns the keys while it is open.
 *
 * A digit on an empty field is typed into it and highlights that quick day; it commits after
 * `quickPickMs`, at once on Enter, and is cancelled by Backspace or by any further character
 * (which makes it ordinary text, so "20 nov" works).
 */
export function DayPicker({
  today,
  initial,
  allowNoDay,
  onPick,
  onClose,
  quickPickMs = QUICK_PICK_MS,
}: DayPickerProps) {
  const grid = useMemo(() => dayGrid(today, GRID_WEEKS), [today])
  const last = grid[grid.length - 1]![6]!.date
  const inGrid = (d: ISODate) => d >= today && d <= last
  const [text, setText] = useState('')
  const [highlight, setHighlight] = useState<ISODate>(initial && inGrid(initial) ? initial : today)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<ISODate | null>(null) // the provisional quick pick
  const counts = useDayCounts(today, last)
  const byDay = counts.data ?? {}

  const cancelQuick = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: on mount only; cancelQuick reads refs.
  useEffect(() => {
    inputRef.current?.focus()
    return cancelQuick
  }, [])

  const typed = text.trim() === '' ? null : parseDayInput(text, today)
  const past = typed !== null && typed < today
  // A day before today is not offered anywhere, so typing one does not count as a day.
  const parsed = typed !== null && !past ? typed : null
  const outside = parsed !== null && !inGrid(parsed)

  const onText = (value: string) => {
    cancelQuick() // more than the digit: it is text now
    setText(value)
    const d = value.trim() === '' ? null : parseDayInput(value, today)
    if (d !== null && inGrid(d) && d >= today) setHighlight(d)
  }

  const quickPick = (date: ISODate, digit: string) => {
    cancelQuick()
    pending.current = date
    setText(digit)
    setHighlight(date)
    timer.current = setTimeout(() => {
      cancelQuick()
      onPick(date)
    }, quickPickMs)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey) return
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Escape') {
      handled()
      cancelQuick()
      return onClose()
    }
    if (e.key === 'Enter') {
      if (e.target instanceof HTMLButtonElement) return // a focused button keeps its own Enter
      handled()
      if (pending.current) {
        const d = pending.current
        cancelQuick()
        return onPick(d)
      }
      if (text.trim() === '') return onPick(highlight)
      if (parsed !== null) onPick(parsed)
      return
    }
    if (e.key === 'Backspace' && pending.current) {
      handled()
      cancelQuick()
      return setText('')
    }
    if (/^[1-9]$/.test(e.key) && text === '' && e.target === inputRef.current) {
      handled()
      return quickPick(addDays(today, Number(e.key) - 1), e.key)
    }
    const step = MOVES[e.key]
    if (step === undefined) return
    // With text in the field, ← and → move the caret instead.
    if (text !== '' && !pending.current && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
    handled()
    // ↑↓ leave typed text behind and move from the day it named, if the grid has it.
    const from = parsed !== null && inGrid(parsed) ? parsed : highlight
    if (text !== '') setText('')
    cancelQuick()
    const next = addDays(from, step)
    // biome-ignore lint/complexity/useMathMinMax: these are ISO date strings; Math.min would give NaN.
    setHighlight(next < today ? today : next > last ? last : next)
  }

  const quick = Array.from({ length: 9 }, (_, i) => addDays(today, i))
  const month = `${MONTH_NAMES[Number(highlight.slice(5, 7)) - 1]} ${highlight.slice(0, 4)}`
  const status = counts.isError ? 'Counts unavailable' : counts.isPending ? 'Loading counts…' : null

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
            // mousemove, not mouseenter: a pointer resting under the card must not take the highlight.
            onMouseMove={() => d !== highlight && setHighlight(d)}
            tabIndex={-1}
          >
            <span className="picker__qkey">{i + 1}</span>
            <span className="picker__qlabel">{longLabel(d, today)}</span>
            <span className="picker__load" role="img" aria-label={tasks(byDay[d] ?? 0)}>
              {load(byDay[d] ?? 0)}
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
            <button
              type="button"
              className="picker__none"
              onClick={() => onPick(null)}
              tabIndex={-1}
            >
              No day
            </button>
          )}
        </div>
        <div className="picker__head">
          <span className="picker__month">{month}</span>
          {past ? (
            <span className="picker__parsed" role="status">
              That day has passed
            </span>
          ) : outside && parsed !== null ? (
            <span className="picker__parsed" role="status">
              Enter picks {short(parsed)} {monthShort(parsed)}
            </span>
          ) : (
            <span className="picker__hint">← → day · ↑ ↓ week · Enter</span>
          )}
        </div>
        <div className="picker__grid" role="group" aria-label="Days">
          {WEEKDAYS.map((w) => (
            <span key={w} className="picker__wd" aria-hidden="true">
              {w}
            </span>
          ))}
          {grid.flat().map(({ date, inMonthLabel }) => {
            const off = daysBetween(today, date)
            const n = byDay[date] ?? 0
            const wd = weekdayName(date, 'short')
            const cls = [
              'picker__day',
              date === highlight && 'is-on',
              off === 0 && 'is-today',
              off < 0 && 'is-past',
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
                disabled={off < 0}
                tabIndex={-1}
                onClick={() => onPick(date)}
              >
                {off >= 0 && off <= 8 && <span className="picker__dkey">{off + 1}</span>}
                <span className="picker__num">
                  {dayNum(date) === 1 ? `1 ${inMonthLabel}` : dayNum(date)}
                </span>
                <span className="picker__dots" aria-hidden="true">
                  {load(n)}
                </span>
              </button>
            )
          })}
        </div>
        <span className="picker__foot">
          1–9 = today … 8 days out. Dots = tasks already on that day. Esc closes.
          {status && (
            <span className="picker__status" role="status">
              {' '}
              {status}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
