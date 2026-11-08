import { memo, useEffect, useRef } from 'react'
import type { FlatRow } from './flatten'
import { DayCell } from './DayCell'
import { RowCheckbox, type RowState } from './RowCheckbox'
import { rowControlClick } from './rowControlClick'
import { TitleEditor } from './TitleEditor'

export interface TreeRowProps {
  row: FlatRow
  today: string
  selected: boolean
  onSelect: (id: string) => void
  onToggleCollapse: (id: string) => void
  onToggleDone: (id: string) => void
  onScheduleToday: (id: string) => void
  /** S: toggle the Doing mark. */
  onDoing: (id: string) => void
  /** D: day picker (no-op until Task 19). */
  onPickDay: (id: string) => void
  /** Id of the confirm note shown under this row, if any. */
  describedBy?: string
  /** The title is being edited (always so for the draft row). */
  editing?: boolean
  /** The user left the title editor: save and return to navigate mode. */
  onLeaveEdit?: (id: string) => void
}

function stateOf(row: FlatRow): RowState {
  const { status, mark } = row.node
  if (status !== 'open') return status
  return mark ?? 'open'
}

const noop = () => {}

const GUIDE_DOTS = (
  <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
    {[2, 6, 10].flatMap((y) => [2, 6].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" fill="currentColor" />))}
  </svg>
)

export const TreeRow = memo(function TreeRow(p: TreeRowProps) {
  const { row, selected } = p
  const { node, depth } = row
  const state = stateOf(row)
  const closed = state === 'done' || state === 'cancelled'
  const strong = state === 'doing' || (row.section === 'projects' && depth === 0)
  const draft = row.isDraft === true
  const editing = p.editing === true
  const rowCls = ['row', selected && 'row--selected', editing && 'row--editing', state === 'doing' && 'row--doing', state === 'done' && 'row--done']
  const titleCls = ['row__title', strong && 'row__title--strong', closed && 'row__title--struck', state === 'cancelled' && 'row__title--cancelled']
  const collapsed = row.hasChildren && node.collapsed
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the one global listener (useKeyboard)
    <div
      ref={ref}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-labelledby={editing ? undefined : `title-${row.id}`}
      aria-label={editing ? node.title || 'New task' : undefined}
      aria-describedby={p.describedBy}
      aria-expanded={row.hasChildren ? !collapsed : undefined}
      className={rowCls.filter(Boolean).join(' ')}
      data-state={state}
      data-id={row.id}
      onClick={() => p.onSelect(row.id)}
    >
      <DayCell date={node.scheduledOn} today={p.today} closed={closed} />
      <span className="row__handle" aria-hidden="true">{GUIDE_DOTS}</span>
      <span className="row__indent" aria-hidden="true" style={{ width: depth * 22 }} />
      {row.hasChildren ? (
        <button
          type="button"
          className="row__chev"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => rowControlClick(e, () => p.onToggleCollapse(row.id))}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ transform: `rotate(${collapsed ? 0 : 90}deg)` }}>
            <path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className="row__chev-gap" aria-hidden="true" />
      )}
      {draft ? (
        <span className="cb cb--open" aria-hidden="true" />
      ) : (
        <RowCheckbox state={state} onToggle={() => p.onToggleDone(row.id)} />
      )}
      {state === 'worked' && (
        <span className="row__worked" data-testid="worked-mark" role="img" aria-label="Worked on today">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 1.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
          </svg>
        </span>
      )}
      {editing ? (
        <TitleEditor id={row.id} strong={strong} placeholder={draft ? 'New task' : undefined} onLeave={p.onLeaveEdit ?? noop} />
      ) : (
        <span id={`title-${row.id}`} className={titleCls.filter(Boolean).join(' ')}>{node.title}</span>
      )}
      {node.notes.trim() !== '' && (
        <svg role="img" aria-label="Has notes" className="row__icon" width="12" height="12" viewBox="0 0 16 16">
          <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      {node.link !== null && node.link.trim() !== '' && (
        <svg role="img" aria-label="Has a link" className="row__icon" width="12" height="12" viewBox="0 0 16 16">
          <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      {collapsed && <span className="row__count">{node.doneCount}/{node.totalCount}</span>}
      <span className="row__spacer" />
      {!closed && !editing && (
        <span className="row__actions">
          <button type="button" className="qa" aria-label="Doing now (S)" onClick={(e) => rowControlClick(e, () => p.onDoing(row.id))}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
            <span className="qa__key">S</span>
          </button>
          <button type="button" className="qa" aria-label="Schedule for today (T)" onClick={(e) => rowControlClick(e, () => p.onScheduleToday(row.id))}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="qa__key">T</span>
          </button>
          <button type="button" className="qa" aria-label="Pick a day (D)" onClick={(e) => rowControlClick(e, () => p.onPickDay(row.id))}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16">
              <rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="qa__key">D</span>
          </button>
        </span>
      )}
    </div>
  )
})
