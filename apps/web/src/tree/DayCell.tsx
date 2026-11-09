import { dayLabel } from '@daybreak/core/dates'
import type { CSSProperties } from 'react'

/** The fixed day column. Empty for closed or unscheduled tasks; a dashed "Today" while `preview` (a drag over My Day). */
export function DayCell({
  date,
  today,
  closed,
  preview,
}: {
  date: string | null
  today: string
  closed: boolean
  preview?: boolean
}) {
  if (preview) {
    return (
      <span className="day" data-testid="day-cell">
        <span className="day__preview">Today</span>
      </span>
    )
  }
  if (date === null || closed) return <span className="day" data-testid="day-cell" />
  const { text, kind, fade } = dayLabel(date, today)
  // Colour is computed in CSS: color-mix(far fade%, near).
  const style = { '--fade': String(fade) } as CSSProperties
  return (
    <span className={`day day--${kind}`} style={style} data-testid="day-cell">
      {text}
    </span>
  )
}
