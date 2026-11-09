import type { DayItem } from '@daybreak/core'
import { memo, useEffect, useRef } from 'react'
import { RowCheckbox, type RowState } from '../tree/RowCheckbox'
import { rowControlClick } from '../tree/rowControlClick'
import { TitleEditor } from '../tree/TitleEditor'

export interface DayRowProps {
  item: DayItem
  selected: boolean
  editing: boolean
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
  /** S: toggle the Doing mark. */
  onDoing: (id: string) => void
  onLeaveEdit: (id: string) => void
  /** Id of the confirm note shown under this row, if any. */
  describedBy?: string
}

export const PATH_SEPARATOR = ' › '

function stateOf(item: DayItem): RowState {
  const { status } = item.task
  if (status !== 'open') return status
  return item.mark ?? 'open'
}

const GUIDE_DOTS = (
  <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
    {[2, 6, 10].flatMap((y) => [2, 6].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" fill="currentColor" />))}
  </svg>
)

export const DayRow = memo(function DayRow({ item, selected, editing, onSelect, onToggleDone, onDoing, onLeaveEdit, describedBy }: DayRowProps) {
  const { task } = item
  const state = stateOf(item)
  const closed = state === 'done' || state === 'cancelled'
  const doing = state === 'doing'
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  const cls = ['row', 'dayrow', selected && 'row--selected', editing && 'row--editing', doing && 'row--doing', state === 'done' && 'row--done']
  const titleCls = ['row__title', 'dayrow__title', doing && 'row__title--strong', closed && 'row__title--struck', state === 'cancelled' && 'row__title--cancelled']

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the one global listener (useKeyboard)
    <div
      ref={ref}
      role="listitem"
      aria-current={selected ? 'true' : undefined}
      aria-describedby={describedBy}
      className={cls.filter(Boolean).join(' ')}
      data-state={state}
      data-id={task.id}
      onClick={() => onSelect(task.id)}
    >
      <span className="row__handle" aria-hidden="true">{GUIDE_DOTS}</span>
      <RowCheckbox round state={state} onToggle={() => onToggleDone(task.id)} />
      <span className="dayrow__text">
        <span className="dayrow__path">{item.path.join(PATH_SEPARATOR)}</span>
        <span className="dayrow__line">
          {state === 'worked' && (
            <span className="row__worked" role="img" aria-label="Worked on today">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7 1.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
              </svg>
            </span>
          )}
          {editing ? (
            <TitleEditor id={task.id} strong={doing} onLeave={onLeaveEdit} />
          ) : (
            <span className={titleCls.filter(Boolean).join(' ')}>{task.title}</span>
          )}
        </span>
      </span>
      {doing && <span className="dayrow__pill dayrow__pill--doing">Doing</span>}
      {state === 'worked' && <span className="dayrow__pill dayrow__pill--worked">Worked on</span>}
      {!closed && !doing && !editing && (
        <button type="button" className="dayrow__start" aria-label="Start (S)" onClick={(e) => rowControlClick(e, () => onDoing(task.id))}>
          <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          Start
          <span className="qa__key">S</span>
        </button>
      )}
    </div>
  )
})
