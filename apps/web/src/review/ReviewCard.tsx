import type { ISODate, ReviewItem } from '@daybreak/core'
import { daysBetween, weekdayName } from '@daybreak/core/dates'
import { useEffect, useRef } from 'react'
import { PATH_SEPARATOR } from '../myday/DayRow'
import { DayPicker } from '../picker/DayPicker'
import { monthShort } from '../picker/dayGrid'
import type { ReviewCommand } from './reviewKeys'

type Choice = Exclude<ReviewCommand, 'undo' | 'start'>

/** "Monday" within the last week, else "2 Nov". */
function workedDay(date: ISODate, today: ISODate): string {
  const ago = daysBetween(date, today)
  return ago >= 1 && ago <= 6
    ? weekdayName(date, 'long')
    : `${Number(date.slice(8, 10))} ${monthShort(date)}`
}

export interface ReviewCardProps {
  item: ReviewItem
  today: ISODate
  /** "3 of 7" for a leftover, "Suggestion" for a suggestion. */
  tag: string
  picking: boolean
  onChoose: (choice: Choice) => void
  onPick: (date: ISODate) => void
  onClosePicker: () => void
}

/**
 * The item being decided: a white card with its path, title, worked-on chip and note, the four
 * choices with their key caps, and the day picker inline after D. It keeps itself in view as the
 * list runs on.
 */
export function ReviewCard({
  item,
  today,
  tag,
  picking,
  onChoose,
  onPick,
  onClosePicker,
}: ReviewCardProps) {
  const { task } = item
  const ref = useRef<HTMLLIElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever the card changes task or opens the picker.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [task.id, picking])
  const suggestion = item.group === 'suggestion'
  const buttons: Array<{ choice: Choice; key: string; label: string; cls: string }> = [
    { choice: 'today', key: 'T', label: 'Today', cls: 'rv-btn--primary' },
    { choice: 'day', key: 'D', label: 'Another day', cls: picking ? 'is-on' : '' },
    { choice: 'backlog', key: 'B', label: suggestion ? 'Not today' : 'Backlog', cls: '' },
    { choice: 'cancel', key: 'X', label: 'Cancel', cls: 'rv-btn--danger' },
  ]
  return (
    <li ref={ref} className="rv-card" aria-current="step">
      <div className="rv-card__top">
        <span className="rv-card__path">{item.path.join(PATH_SEPARATOR)}</span>
        <span className="rv-card__tag">{tag}</span>
      </div>
      <span className="rv-card__title">{task.title}</span>
      {item.workedOn && (
        <span className="rv-card__worked">
          <span className="rv-chip rv-chip--worked">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14">
              <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7 1.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
            </svg>
            Worked on {workedDay(item.workedOn, today)}
          </span>
          <span>Continue today?</span>
        </span>
      )}
      {task.notes.trim() !== '' && <p className="rv-card__note">{task.notes.trim()}</p>}
      <div className="rv-card__actions">
        {buttons.map((b) => (
          <button
            key={b.choice}
            type="button"
            className={`rv-btn ${b.cls}`.trim()}
            aria-expanded={b.choice === 'day' ? picking : undefined}
            onClick={() => onChoose(b.choice)}
          >
            <span className="rv-btn__cap" aria-hidden="true">
              {b.key}
            </span>
            {b.label}
          </button>
        ))}
      </div>
      {picking && (
        <DayPicker
          today={today}
          initial={null}
          allowNoDay={false}
          onPick={(d) => d && onPick(d)}
          onClose={onClosePicker}
        />
      )}
    </li>
  )
}
